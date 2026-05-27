import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';

// Твой сервер, который мы запустили на Render
const socket = io('https://durak-server-6wnc.onrender.com');

export default function App() {
  const [roomId, setRoomId] = useState('');
  const [joined, setJoined] = useState(false);
  const [gameState, setGameState] = useState(null);
  const [myId, setMyId] = useState('');

  useEffect(() => {
    socket.on('connect', () => setMyId(socket.id));
    socket.on('gameState', (state) => setGameState(state));
    return () => { socket.off('connect'); socket.off('gameState'); };
  }, []);

  const joinRoom = () => { if(roomId) { socket.emit('joinRoom', roomId); setJoined(true); } };
  const playCard = (card) => { if(gameState?.turn === myId) { socket.emit('playCard', { roomId, card }); } };

  if (!joined) {
    return (
      <div style={{textAlign: 'center', marginTop: '50px', color: 'white', background: '#18181b', minHeight: '100vh', padding: '20px'}}>
        <h1>Дурак Онлайн</h1>
        <input placeholder="Код комнаты" onChange={(e) => setRoomId(e.target.value)} style={{padding: '10px', display: 'block', margin: '10px auto', color: 'black'}} />
        <button onClick={joinRoom} style={{padding: '10px 20px', background: 'blue', color: 'white', border: 'none', borderRadius: '5px'}}>Войти</button>
      </div>
    );
  }

  if (!gameState) return <div>Загрузка стола...</div>;

  const me = gameState.players.find(p => p.id === myId);
  return (
    <div style={{background: '#065f46', minHeight: '100vh', color: 'white', padding: '20px', textAlign: 'center'}}>
      <h3>Комната: {roomId}</h3>
      <div style={{display: 'flex', justifyContent: 'center', gap: '10px', marginTop: '20px'}}>
        {me?.hand.map(card => (
          <div key={card.id} onClick={() => playCard(card)} style={{background: 'white', color: 'black', padding: '20px', cursor: 'pointer', borderRadius: '8px'}}>
            {card.rank}{card.suit}
          </div>
        ))}
      </div>
    </div>
  );
}