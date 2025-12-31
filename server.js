const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function setup() {
    // Database Setup
    const db = await open({
        filename: './database.sqlite',
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS rooms (
            id TEXT PRIMARY KEY,
            gameState TEXT,
            currentPlayer TEXT,
            scoreX INTEGER DEFAULT 0,
            scoreO INTEGER DEFAULT 0,
            players TEXT,
            isFinished INTEGER DEFAULT 0
        )
    `);

    const app = express();
    const server = http.createServer(app);
    const io = new Server(server);

    app.use(express.static(__dirname));

    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'index.html'));
    });

    io.on('connection', (socket) => {
        console.log('User connected:', socket.id);

        socket.on('join-room', async ({ roomId, playerId }) => {
            socket.join(roomId);

            let roomData = await db.get('SELECT * FROM rooms WHERE id = ?', [roomId]);

            if (!roomData) {
                // Initialize room if it doesn't exist
                const initialRoom = {
                    gameState: JSON.stringify(Array(9).fill("")),
                    currentPlayer: 'X',
                    scoreX: 0,
                    scoreO: 0,
                    players: JSON.stringify([]),
                    isFinished: 0
                };
                await db.run(
                    'INSERT INTO rooms (id, gameState, currentPlayer, scoreX, scoreO, players, isFinished) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [roomId, initialRoom.gameState, initialRoom.currentPlayer, initialRoom.scoreX, initialRoom.scoreO, initialRoom.players, initialRoom.isFinished]
                );
                roomData = { id: roomId, ...initialRoom };
            } else {
                // Parse strings back to objects
                roomData.gameState = JSON.parse(roomData.gameState);
                roomData.players = JSON.parse(roomData.players);
                roomData.scores = { X: roomData.scoreX, O: roomData.scoreO };
            }

            // Assign role based on unique playerId (not socket id)
            let players = Array.isArray(roomData.players) ? roomData.players : JSON.parse(roomData.players || '[]');
            let existingPlayer = players.find(p => p.playerId === playerId);

            if (existingPlayer) {
                socket.emit('player-assignment', existingPlayer.role);
            } else if (players.length < 2) {
                const role = players.length === 0 ? 'X' : 'O';
                players.push({ playerId, role });
                await db.run('UPDATE rooms SET players = ? WHERE id = ?', [JSON.stringify(players), roomId]);
                socket.emit('player-assignment', role);
            } else {
                socket.emit('player-assignment', 'viewer');
            }

            // Send full state
            socket.emit('init-state', {
                gameState: typeof roomData.gameState === 'string' ? JSON.parse(roomData.gameState) : roomData.gameState,
                currentPlayer: roomData.currentPlayer,
                scores: { X: roomData.scoreX, O: roomData.scoreO },
                isFinished: roomData.isFinished
            });
        });

        socket.on('make-move', async ({ roomId, index, player }) => {
            const room = await db.get('SELECT * FROM rooms WHERE id = ?', [roomId]);
            if (!room || room.isFinished) return;

            const gameState = JSON.parse(room.gameState);
            if (gameState[index] === "" && room.currentPlayer === player) {
                gameState[index] = player;
                const nextPlayer = player === 'X' ? 'O' : 'X';

                // Check win
                const winIndices = checkWin(gameState);
                let isFinished = 0;
                let scoreX = room.scoreX;
                let scoreO = room.scoreO;

                if (winIndices) {
                    isFinished = 1;
                    if (player === 'X') scoreX++; else scoreO++;
                } else if (!gameState.includes("")) {
                    isFinished = 1;
                }

                await db.run(
                    'UPDATE rooms SET gameState = ?, currentPlayer = ?, isFinished = ?, scoreX = ?, scoreO = ? WHERE id = ?',
                    [JSON.stringify(gameState), nextPlayer, isFinished, scoreX, scoreO, roomId]
                );

                io.to(roomId).emit('update-game', {
                    gameState,
                    currentPlayer: nextPlayer,
                    scores: { X: scoreX, O: scoreO },
                    isFinished
                });
            }
        });

        socket.on('reset-game', async (roomId) => {
            const emptyState = JSON.stringify(Array(9).fill(""));
            await db.run(
                'UPDATE rooms SET gameState = ?, currentPlayer = ?, isFinished = 0 WHERE id = ?',
                [emptyState, 'X', roomId]
            );
            io.to(roomId).emit('update-game', {
                gameState: Array(9).fill(""),
                currentPlayer: 'X',
                scores: await getScores(db, roomId),
                isFinished: 0
            });
        });
    });

    async function getScores(db, roomId) {
        const r = await db.get('SELECT scoreX, scoreO FROM rooms WHERE id = ?', [roomId]);
        return { X: r.scoreX, O: r.scoreO };
    }

    function checkWin(gs) {
        const wins = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
        for (let comb of wins) {
            if (gs[comb[0]] && gs[comb[0]] === gs[comb[1]] && gs[comb[0]] === gs[comb[2]]) return comb;
        }
        return null;
    }

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

setup();
