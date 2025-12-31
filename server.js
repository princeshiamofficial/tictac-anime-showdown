const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Store room states
const rooms = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-room', (roomId) => {
        socket.join(roomId);
        console.log(`User ${socket.id} joined room: ${roomId}`);

        // If room doesn't exist, initialize it
        if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                gameState: Array(9).fill(""),
                currentPlayer: 'X',
                scores: { X: 0, O: 0 },
                players: []
            });
        }

        const room = rooms.get(roomId);
        
        // Assign player slot (X or O)
        if (room.players.length < 2) {
            const role = room.players.length === 0 ? 'X' : 'O';
            room.players.push({ id: socket.id, role });
            socket.emit('player-assignment', role);
        } else {
            socket.emit('player-assignment', 'viewer');
        }

        // Send current room state to the new user
        socket.emit('init-state', room);
        
        // Notify others
        socket.to(roomId).emit('user-joined', socket.id);
    });

    socket.on('make-move', ({ roomId, index, player }) => {
        const room = rooms.get(roomId);
        if (room && room.gameState[index] === "" && room.currentPlayer === player) {
            room.gameState[index] = player;
            room.currentPlayer = player === 'X' ? 'O' : 'X';
            
            io.to(roomId).emit('update-game', room);
        }
    });

    socket.on('reset-game', (roomId) => {
        const room = rooms.get(roomId);
        if (room) {
            room.gameState = Array(9).fill("");
            room.currentPlayer = 'X';
            io.to(roomId).emit('update-game', room);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Clean up rooms if needed (optional for MVP)
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
