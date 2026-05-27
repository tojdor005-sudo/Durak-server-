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
const cardValues = { '6':6, '7':7, '8':8, '9':9, '10':10, 'J':11, 'Q':12, 'K':13, 'A':14 };

function createDeck() {
  const suits = ['♠', '♣', '♥', '♦'];
  const ranks = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  let deck = [];
  for (let suit of suits) {
    for (let rank of ranks) {
      deck.push({ rank, suit, id: rank+suit });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

io.on('connection', (socket) => {
  socket.on('joinRoom', (roomId) => {
    socket.join(roomId);
    
    if (!rooms[roomId]) {
      let deck = createDeck();
      // Раздаем карты, а следующая карта после раздачи (или последняя) определит козырь
      let trumpCard = deck[deck.length - 1]; 
      rooms[roomId] = { 
        players: [], 
        table: [], // теперь это массив пар: [{attack: card, defense: card || null}]
        deck: deck, 
        trump: trumpCard ? trumpCard.suit : '♥',
        trumpCard: trumpCard,
        turn: null, // кто атакует
        defender: null // кто защищается
      };
    }
    
    let room = rooms[roomId];
    
    if (room.players.length < 2 && !room.players.find(p => p.id === socket.id)) {
      room.players.push({
        id: socket.id,
        hand: room.deck.splice(0, 6)
      });
    }

    if (room.players.length === 2 && !room.turn) {
      room.turn = room.players[0].id;
      room.defender = room.players[1].id;
    }
    
    io.to(roomId).emit('gameState', room);
  });

  // Игрок атакует (кидает карту)
  socket.on('attackCard', ({ roomId, card }) => {
    let room = rooms[roomId];
    if (!room || room.turn !== socket.id) return;

    let player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    // Правило: на стол можно подкидывать только если он пустой, 
    // или если карта совпадает по рангу с уже лежащими
    if (room.table.length > 0) {
      let allowedRanks = [];
      room.table.forEach(pair => {
        allowedRanks.push(pair.attack.rank);
        if (pair.defense) allowedRanks.push(pair.defense.rank);
      });
      if (!allowedRanks.includes(card.rank)) return; // нельзя подкинуть эту карту
    }

    // Удаляем из руки и кладем на стол как атакующую
    player.hand = player.hand.filter(c => c.id !== card.id);
    room.table.push({ attack: card, defense: null });

    io.to(roomId).emit('gameState', room);
  });

  // Игрок защищается (бьет карту)
  socket.on('defendCard', ({ roomId, cardId, withCard }) => {
    let room = rooms[roomId];
    if (!room || room.defender !== socket.id) return;

    let player = room.players.find(p => p.id === socket.id);
    let pair = room.table.find(p => p.attack.id === cardId && !p.defense);
    if (!player || !pair) return;

    // Проверка правил боя:
    let att = pair.attack;
    let def = withCard;
    let isLegal = false;

    if (att.suit === def.suit) {
      // Обычный бой: масть одинаковая, номинал защищающейся должен быть выше
      if (cardValues[def.rank] > cardValues[att.rank]) isLegal = true;
    } else if (def.suit === room.trump) {
      // Защита козырем: атака была некозырной, защита козырная
      isLegal = true;
    }

    if (isLegal) {
      player.hand = player.hand.filter(c => c.id !== def.id);
      pair.defense = def;
      io.to(roomId).emit('gameState', room);
    }
  });

  // Действие "БИТО" или "ВЗЯТЬ"
  socket.on('action', ({ roomId, type }) => {
    let room = rooms[roomId];
    if (!room) return;

    if (type === 'bito' && socket.id === room.turn) {
      // Все ли карты побиты?
      let allDefended = room.table.every(p => p.defense !== null);
      if (!allDefended || room.table.length === 0) return;

      // Очищаем стол (уходит в отбой)
      room.table = [];

      // Добираем карты до 6
      room.players.forEach(p => {
        while (p.hand.length < 6 && room.deck.length > 0) {
          p.hand.push(room.deck.shift());
        }
      });

      // Меняем роли (защищавшийся теперь атакует)
      let temp = room.turn;
      room.turn = room.defender;
      room.defender = temp;

      io.to(roomId).emit('gameState', room);
    }

    if (type === 'take' && socket.id === room.defender) {
      let player = room.players.find(p => p.id === socket.id);
      if (!player) return;

      // Забирает все карты со стола в руку
      room.table.forEach(pair => {
        player.hand.push(pair.attack);
        if (pair.defense) player.hand.push(pair.defense);
      });
      room.table = [];

      // Добираем карты тому, кто ходил
      let attacker = room.players.find(p => p.id === room.turn);
      while (attacker.hand.length < 6 && room.deck.length > 0) {
        attacker.hand.push(room.deck.shift());
      }

      // Ход НЕ переходит, атакует тот же человек, так как этот взял
      io.to(roomId).emit('gameState', room);
    }
  });
});

server.listen(3000, () => console.log('Сервер запущен'));
