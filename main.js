const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const dbURI = process.env.MONGODB_URI;

// Middleware for CORS with restricted origins
const corsOptions = {
    origin: ["https://chat-app2-roan.vercel.app", "http://localhost:3000"], // Allow production and local development origins
    methods: ["GET", "POST"], // Restrict to GET and POST
    credentials: true, // Allow credentials
};
app.use(cors(corsOptions));
app.use(express.json());

// Socket.IO setup with CORS
const io = new Server(server, {
    cors: {
        origin: "https://chat-app2-roan.vercel.app", // Match frontend URL
        methods: ["GET", "POST"],
    },
});

// MongoDB connection with error handling
mongoose.connect(dbURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// User Schema
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model('User', userSchema);

// Message Schema
const messageSchema = new mongoose.Schema({
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    read: { type: Boolean, default: false },
});
const Message = mongoose.model('Message', messageSchema);

// Message history endpoint
app.get('/api/messages/:userId1/:userId2', async (req, res) => {
    try {
        const { userId1, userId2 } = req.params;
        const messages = await Message.find({
            $or: [
                { sender: userId1, recipient: userId2 },
                { sender: userId2, recipient: userId1 },
            ],
        }).sort({ timestamp: 1 });
        res.json(messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ message: 'Error fetching messages' });
    }
});

// Registration endpoint
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

// Login endpoint
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

// Socket.IO setup
const connectedUsers = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('register', async (userId) => {
        try {
            const user = await User.findById(userId);
            if (user) {
                connectedUsers.set(userId, socket.id);
                io.emit('userList', Array.from(connectedUsers.keys()));

                const pendingMessages = await Message.find({
                    recipient: userId,
                    read: false,
                });

                pendingMessages.forEach((msg) => {
                    socket.emit('receiveMessage', {
                        messageId: msg._id,
                        senderId: msg.sender,
                        content: msg.content,
                        timestamp: msg.timestamp,
                    });
                });
            }
        } catch (error) {
            console.error('Error in user registration:', error);
            socket.emit('error', 'Failed to register user');
        }
    });

    socket.on('sendMessage', async ({ senderId, recipientId, content }) => {
        try {
            const senderObjId = new mongoose.Types.ObjectId(senderId);
            const recipientObjId = new mongoose.Types.ObjectId(recipientId);

            const message = new Message({
                sender: senderObjId,
                recipient: recipientObjId,
                content,
                timestamp: new Date(),
            });
            await message.save();

            const messageData = {
                messageId: message._id,
                senderId,
                content,
                timestamp: message.timestamp,
            };

            const recipientSocketId = connectedUsers.get(recipientId);
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('receiveMessage', messageData);
            }

            socket.emit('messageSent', messageData);
        } catch (error) {
            console.error('Error sending message:', error);
            socket.emit('messageError', 'Failed to send message');
        }
    });

    socket.on('typing', ({ senderId, recipientId }) => {
        const recipientSocketId = connectedUsers.get(recipientId);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('userTyping', { userId: senderId });
        }
    });

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
