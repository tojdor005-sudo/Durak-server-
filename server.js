const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = {};
const RANKS = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['♠', '♣', '♥', '♦'];
const CARD_VALUES = { '6':6, '7':7, '8':8, '9':9, '10':10, 'J':11, 'Q':12, 'K':13, 'A':14 };

function createDeck() {
  let deck = [];
  for (let suit of SUITS) {
    for (let rank of RANKS) {
      deck.push({ rank, suit, id: rank + suit });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

function getNextPlayer(room, currentId) {
  let idx = room.players.findIndex(p => p.id === currentId);
  for (let i = 1; i <= room.players.length; i++) {
    let nextIdx = (idx + i) % room.players.length;
    let p = room.players[nextIdx];
    if (p.hand.length > 0) return p.id;
  }
  return null;
}

function determineFirstTurn(room) {
  let lowestValue = 99;
  let starterId = room.players[0].id;
  room.players.forEach(p => {
    p.hand.forEach(c => {
      if (c.suit === room.trump) {
        let val = CARD_VALUES[c.rank];
        if (val < lowestValue) {
          lowestValue = val;
          starterId = p.id;
        }
      }
    });
  });
  return starterId;
}

function refillHands(room) {
  if (room.deck.length === 0) return;
  room.players.forEach(p => {
    while (p.hand.length < 6 && room.deck.length > 0) {
      p.hand.push(room.deck.shift());
    }
  });
}

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomId, maxPlayers, tgName, tgPhoto }) => {
    socket.join(roomId);
    if (!rooms[roomId]) {
      let deck = createDeck();
      let trumpCard = deck[deck.length - 1];
      rooms[roomId] = {
        id: roomId, maxPlayers: parseInt(maxPlayers) || 2, players: [],
        table: [], deck: deck, trump: trumpCard.suit,
        turn: null, defender: null, status: 'waiting', durak: null
      };
    }
    let room = rooms[roomId];
    if (room.status === 'waiting' && !room.players.find(p => p.id === socket.id)) {
      room.players.push({ id: socket.id, hand: [], name: tgName, photo: tgPhoto });
    }
    if (room.status === 'waiting' && room.players.length >= room.maxPlayers) {
      room.status = 'playing';
      room.players.forEach(p => p.hand = room.deck.splice(0, 6));
      room.turn = determineFirstTurn(room);
      room.defender = getNextPlayer(room, room.turn);
    }
    io.to(roomId).emit('gameState', room);
  });

  socket.on('attackCard', ({ roomId, card }) => {
    let room = rooms[roomId];
    if (!room || room.status !== 'playing' || room.turn !== socket.id) return;
    let player = room.players.find(p => p.id === socket.id);
    if (room.table.length > 0) {
      let allowed = [];
      room.table.forEach(p => { allowed.push(p.attack.rank); if(p.defense) allowed.push(p.defense.rank); });
      if (!allowed.includes(card.rank)) return;
    }
    player.hand = player.hand.filter(c => c.id !== card.id);
    room.table.push({ attack: card, defense: null });
    io.to(roomId).emit('gameState', room);
  });

  socket.on('defendCard', ({ roomId, cardId, withCard }) => {
    let room = rooms[roomId];
    if (!room || room.defender !== socket.id) return;
    let player = room.players.find(p => p.id === socket.id);
    let pair = room.table.find(p => p.attack.id === cardId && !p.defense);
    if (!player || !pair) return;
    let isLegal = (withCard.suit === pair.attack.suit && CARD_VALUES[withCard.rank] > CARD_VALUES[pair.attack.rank]) || (withCard.suit === room.trump);
    if (isLegal) {
      player.hand = player.hand.filter(c => c.id !== withCard.id);
      pair.defense = withCard;
      io.to(roomId).emit('gameState', room);
    }
  });

  socket.on('action', ({ roomId, type }) => {
    let room = rooms[roomId];
    if (!room) return;
    if (type === 'bito' && socket.id === room.turn) {
      if (room.table.length === 0 || !room.table.every(p => p.defense)) return;
      room.table = [];
      refillHands(room);
      room.turn = room.defender;
      room.defender = getNextPlayer(room, room.turn);
    } else if (type === 'take' && socket.id === room.defender) {
      let p = room.players.find(p => p.id === socket.id);
      room.table.forEach(pair => { p.hand.push(pair.attack); if(pair.defense) p.hand.push(pair.defense); });
      room.table = [];
      refillHands(room);
      room.turn = getNextPlayer(room, room.defender);
      room.defender = getNextPlayer(room, room.turn);
    }
    io.to(roomId).emit('gameState', room);
  });
});

server.listen(3000, () => console.log('Сервер готов к работе!'));
