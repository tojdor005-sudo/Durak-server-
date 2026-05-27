const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = {};

const generateDeck = () => {
  const suits = ['♠', '♣', '♥', '♦'];
  const ranks = [6, 7, 8, 9, 10, 11, 12, 13, 14];
  let deck = [];
  for (let suit of suits) {
    for (let rank of ranks) {
      deck.push({ id: `${rank}${suit}`, rank, suit, isRed: suit === '♥' || suit === '♦' });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
};

io.on('connection', (socket) => {
  socket.on('joinRoom', (roomId) => {
    socket.join(roomId);
    if (!rooms[roomId]) {
      const deck = generateDeck();
      rooms[roomId] = { players: [], deck, trump: deck[deck.length - 1], table: [], turn: null };
    }
    const room = rooms[roomId];
    if (room.players.length < 2) {
      room.players.push({ id: socket.id, hand: room.deck.splice(0, 6) });
      if (room.players.length === 1) room.turn = socket.id;
    }
    io.to(roomId).emit('gameState', room);
  });

  socket.on('playCard', ({ roomId, card }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || room.turn !== socket.id) return;

    player.hand = player.hand.filter(c => c.id !== card.id);
    room.table.push(card);
    const other = room.players.find(p => p.id !== socket.id);
    if (other) room.turn = other.id;

    io.to(roomId).emit('gameState', room);
  });
});

server.listen(3000, () => console.log('Сервер работает'));
