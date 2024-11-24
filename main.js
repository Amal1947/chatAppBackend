const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const dbURI = process.env.MONGODB_URI;
// Middleware
app.use(cors());
app.use(express.json());

// Socket.IO setup with error handling
const io = new Server(server, {
    cors: {
        origin: ["https://chat-app2-roan.vercel.app/"],
        methods: ["GET", "POST"],
    },
});


// MongoDB connection with better error handling
mongoose.connect(dbURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('MongoDB Connected'))
.catch(err => console.error('MongoDB Connection Error:', err));

// Enhanced User Schema
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Enhanced Message Schema
const messageSchema = new mongoose.Schema({
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    read: { type: Boolean, default: false }
});
const Message = mongoose.model('Message', messageSchema);


// Add message history endpoint
app.get('/api/messages/:userId1/:userId2', async (req, res) => {

    console.log("hit");
    
    try {
        const { userId1, userId2 } = req.params;
        
        const messages = await Message.find({
            $or: [
                { sender: userId1, recipient: userId2 },
                { sender: userId2, recipient: userId1 }
            ]
        }).sort({ timestamp: 1 });
        console.log("hit message",messages);
        
        res.json(messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ message: 'Error fetching messages' });
    }
});

// Routes (keep your existing register and login routes)
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: 'Username already exists' });
        }
        const user = new User({ username, password });
        await user.save();
        res.status(201).json({ message: 'User created successfully' });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Error creating user' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ message: 'User not found' });
        }
        if (user.password !== password) {
            return res.status(400).json({ message: 'Invalid password' });
        }
        res.json({ userId: user._id.toString(), username: user.username });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Error logging in' });
    }
});

// Improved Socket.IO connection handling
const connectedUsers = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Handle user registration with error handling
    socket.on('register', async (userId) => {
        try {
            const user = await User.findById(userId);
            if (user) {
                connectedUsers.set(userId, socket.id);
                io.emit('userList', Array.from(connectedUsers.keys()));
                
                // Send pending messages
                const pendingMessages = await Message.find({
                    recipient: userId,
                    read: false
                });
                
                pendingMessages.forEach(msg => {
                    socket.emit('receiveMessage', {
                        messageId: msg._id,
                        senderId: msg.sender,
                        content: msg.content,
                        timestamp: msg.timestamp
                    });
                });
            }
        } catch (error) {
            console.error('Error in user registration:', error);
            socket.emit('error', 'Failed to register user');
        }
    });

    // Enhanced message sending with acknowledgment
    socket.on('sendMessage', async ({ senderId, recipientId, content }) => {
        try {
            // Convert string IDs to ObjectIds
            const senderObjId = new mongoose.Types.ObjectId(senderId);
            const recipientObjId = new mongoose.Types.ObjectId(recipientId);

            // Save message to database
            const message = new Message({
                sender: senderObjId,
                recipient: recipientObjId,
                content,
                timestamp: new Date()
            });
            await message.save();

            const messageData = {
                messageId: message._id,
                senderId,
                content,
                timestamp: message.timestamp
            };

            // Send to recipient if online
            const recipientSocketId = connectedUsers.get(recipientId);
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('receiveMessage', messageData);
            }

            // Send back to sender for confirmation
            socket.emit('messageSent', messageData);

        } catch (error) {
            console.error('Error sending message:', error);
            socket.emit('messageError', 'Failed to send message');
        }
    });

    // Handle typing indicators
    socket.on('typing', ({ senderId, recipientId }) => {
        const recipientSocketId = connectedUsers.get(recipientId);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('userTyping', { userId: senderId });
        }
    });

    // Enhanced disconnect handling
    socket.on('disconnect', () => {
        let disconnectedUserId;
        for (const [userId, socketId] of connectedUsers.entries()) {
            if (socketId === socket.id) {
                disconnectedUserId = userId;
                break;
            }
        }
        
        if (disconnectedUserId) {
            connectedUsers.delete(disconnectedUserId);
            io.emit('userList', Array.from(connectedUsers.keys()));
            io.emit('userDisconnected', disconnectedUserId);
        }
        
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});