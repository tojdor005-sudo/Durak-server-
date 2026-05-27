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

// Поиск следующего игрока с картами по кругу
function getNextPlayer(room, currentId) {
  let idx = room.players.findIndex(p => p.id === currentId);
  for (let i = 1; i <= room.players.length; i++) {
    let nextIdx = (idx + i) % room.players.length;
    let p = room.players[nextIdx];
    if (p.hand.length > 0) return p.id;
  }
  return null;
}

// Определение игрока с наименьшим козырем для старта
function determineFirstTurn(room) {
  let lowestValue = 99;
  let starterId = room.players[0].id;
  let hasTrump = false;

  room.players.forEach(p => {
    p.hand.forEach(c => {
      if (c.suit === room.trump) {
        hasTrump = true;
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

// Раздача карт из колоды до 6 штук каждому активному игроку
function refillHands(room) {
  if (room.deck.length === 0) return;
  room.players.forEach(p => {
    while (p.hand.length < 6 && room.deck.length > 0) {
      p.hand.push(room.deck.shift());
    }
  });
}

// Проверка на окончание игры или вылет игроков
function checkGameStatus(room, roomId) {
  // Игроки без карт при пустой колоде побеждают
  if (room.deck.length === 0) {
    let activePlayers = room.players.filter(p => p.hand.length > 0);
    if (activePlayers.length === 1) {
      room.status = 'ended';
      room.durak = activePlayers[0].id;
    } else if (activePlayers.length === 0) {
      room.status = 'ended';
      room.durak = 'Ничья';
    }
  }
}

io.on('connection', (socket) => {
  console.log('Игрок подключился:', socket.id);

  // Создание или вход в комнату с настройкой лимита игроков
  socket.on('joinRoom', ({ roomId, maxPlayers }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      let deck = createDeck();
      let trumpCard = deck[deck.length - 1];
      rooms[roomId] = {
        id: roomId,
        maxPlayers: parseInt(maxPlayers) || 2,
        players: [],
        table: [], // Массив пар [{ attack: card, defense: card/null }]
        deck: deck,
        trump: trumpCard ? trumpCard.suit : '♥',
        trumpCard: trumpCard,
        turn: null,      // Кто атакует
        defender: null,  // Кто отбивается
        status: 'waiting', // waiting, playing, ended
        durak: null
      };
    }

    let room = rooms[roomId];

    if (room.status === 'waiting' && room.players.length < room.maxPlayers) {
      if (!room.players.find(p => p.id === socket.id)) {
        room.players.push({ id: socket.id, hand: [] });
      }
    }

    // Если комната заполнилась — запускаем раздачу и определяем первый ход
    if (room.status === 'waiting' && room.players.length === room.maxPlayers) {
      room.status = 'playing';
      room.players.forEach(p => {
        p.hand = room.deck.splice(0, 6);
      });
      room.turn = determineFirstTurn(room);
      room.defender = getNextPlayer(room, room.turn);
    }

    io.to(roomId).emit('gameState', room);
  });

  // Логика атаки (подбрасывание карт)
  socket.on('attackCard', ({ roomId, card }) => {
    let room = rooms[roomId];
    if (!room || room.status !== 'playing') return;

    // Подкидывать может атакующий (или любой игрок, если расширять правила, но тут пока базовый атакующий)
    if (room.turn !== socket.id) return;

    let player = room.players.find(p => p.id === socket.id);
    let defenderPlayer = room.players.find(p => p.id === room.defender);
    if (!player || !defenderPlayer) return;

    // Нельзя подкинуть больше карт, чем есть на руках у защищающегося
    let unbeatCount = room.table.filter(pair => !pair.defense).length;
    if (unbeatCount >= defenderPlayer.hand.length) return;

    // Правило подкидывания: номинал должен совпадать с тем, что уже есть на столе
    if (room.table.length > 0) {
      let allowedRanks = [];
      room.table.forEach(pair => {
        allowedRanks.push(pair.attack.rank);
        if (pair.defense) allowedRanks.push(pair.defense.rank);
      });
      if (!allowedRanks.includes(card.rank)) return;
    }

    player.hand = player.hand.filter(c => c.id !== card.id);
    room.table.push({ attack: card, defense: null });

    io.to(roomId).emit('gameState', room);
  });

  // Логика защиты (отбивание карт)
  socket.on('defendCard', ({ roomId, cardId, withCard }) => {
    let room = rooms[roomId];
    if (!room || room.defender !== socket.id) return;

    let player = room.players.find(p => p.id === socket.id);
    let pair = room.table.find(p => p.attack.id === cardId && !p.defense);
    if (!player || !pair) return;

    let att = pair.attack;
    let def = withCard;
    let isLegal = false;

    if (att.suit === def.suit) {
      if (CARD_VALUES[def.rank] > CARD_VALUES[att.rank]) isLegal = true;
    } else if (def.suit === room.trump) {
      isLegal = true;
    }

    if (isLegal) {
      player.hand = player.hand.filter(c => c.id !== def.id);
      pair.defense = def;
      io.to(roomId).emit('gameState', room);
    }
  });

  // Действия раунда: БИТО или ВЗЯТЬ
  socket.on('action', ({ roomId, type }) => {
    let room = rooms[roomId];
    if (!room || room.status !== 'playing') return;

    // Атакующий жмет БИТО
    if (type === 'bito' && socket.id === room.turn) {
      let allDefended = room.table.every(pair => pair.defense !== null);
      if (!allDefended || room.table.length === 0) return;

      room.table = []; // Очищаем стол в отбой
      refillHands(room);
      checkGameStatus(room, roomId);

      if (room.status === 'playing') {
        // Ход переходит к защищавшемуся
        room.turn = room.defender;
        room.defender = getNextPlayer(room, room.turn);
      }
      io.to(roomId).emit('gameState', room);
    }

    // Защищающийся жмет ВЗЯТЬ КАРТЫ
    if (type === 'take' && socket.id === room.defender) {
      let player = room.players.find(p => p.id === socket.id);
      if (!player) return;

      // Забирает всё со стола
      room.table.forEach(pair => {
        player.hand.push(pair.attack);
        if (pair.defense) player.hand.push(pair.defense);
      });
      room.table = [];

      refillHands(room);
      checkGameStatus(room, roomId);

      if (room.status === 'playing') {
        // Так как игрок взял карты, он пропускает ход. Ходит следующий после него.
        room.turn = getNextPlayer(room, room.defender);
        room.defender = getNextPlayer(room, room.turn);
      }
      io.to(roomId).emit('gameState', room);
    }
  });

  socket.on('disconnect', () => {
    console.log('Игрок отключился:', socket.id);
    // Для простоты, при выходе игрока можно очищать связанные комнаты
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
