import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const API_URL = 'http://localhost:5000';
const WS_URL = 'ws://localhost:5000';

function App() {
  const [authToken, setAuthToken] = useState(localStorage.getItem('authToken'));
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });
  const [currentPage, setCurrentPage] = useState('rooms');
  const [rooms, setRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [roomMembers, setRoomMembers] = useState([]);
  const [pomodoroState, setPomodoroState] = useState({
    isRunning: false,
    timeLeft: 1500,
    isBreak: false,
  });
  const [focusMode, setFocusMode] = useState(false);
  const ws = useRef(null);

  // WebSocket setup
  useEffect(() => {
    if (!authToken) return;

    ws.current = new WebSocket(WS_URL);

    ws.current.onopen = () => {
      ws.current.send(JSON.stringify({ type: 'auth', token: authToken }));
    };

    ws.current.onmessage = (event) => {
      const message = JSON.parse(event.data);

      switch (message.type) {
        case 'chat_message':
          setMessages(prev => [...prev, message.message]);
          break;
        case 'user_joined':
          setRoomMembers(message.members);
          setMessages(prev => [...prev, {
            id: 'system-' + Date.now(),
            username: 'System',
            text: `${message.member.username} joined the room`,
            timestamp: new Date().toISOString(),
            isSystem: true,
          }]);
          break;
        case 'user_left':
          setRoomMembers(message.members);
          break;
        case 'pomodoro_update':
          setPomodoroState(message.pomodoroState);
          break;
        case 'pomodoro_tick':
          setPomodoroState(prev => ({ ...prev, timeLeft: message.timeLeft }));
          break;
        case 'focus_mode_toggled':
          setFocusMode(message.focusMode);
          break;
        case 'room_state':
          setMessages(message.messages);
          setRoomMembers(message.members);
          setPomodoroState(message.pomodoroState);
          break;
      }
    };

    return () => ws.current?.close();
  }, [authToken]);

  // Pomodoro timer effect
  useEffect(() => {
    if (!pomodoroState.isRunning) return;

    const interval = setInterval(() => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'pomodoro_tick' }));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [pomodoroState.isRunning]);

  // Fetch rooms
  useEffect(() => {
    const fetchRooms = async () => {
      const response = await fetch(`${API_URL}/api/rooms`);
      const data = await response.json();
      setRooms(data);
    };

    fetchRooms();
    const interval = setInterval(fetchRooms, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleAuth = async (email, password, isLogin) => {
    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
    const response = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        username: email.split('@')[0],
      }),
    });

    const data = await response.json();
    if (data.token) {
      setAuthToken(data.token);
      setUser(data.user);
      localStorage.setItem('authToken', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setCurrentPage('rooms');
    }
  };

  const handleCreateRoom = async (name) => {
    const response = await fetch(`${API_URL}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, maxMembers: 10 }),
    });

    const { roomId } = await response.json();
    handleJoinRoom(roomId);
  };

  const handleJoinRoom = (roomId) => {
    setSelectedRoom(roomId);
    setMessages([]);
    setRoomMembers([]);
    setCurrentPage('study');
    setPomodoroState({ isRunning: false, timeLeft: 1500, isBreak: false });
    setFocusMode(false);

    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'join_room', roomId }));
    }
  };

  const handleSendMessage = () => {
    if (!newMessage.trim() || !ws.current) return;

    ws.current.send(JSON.stringify({
      type: 'chat_message',
      text: newMessage,
    }));

    setNewMessage('');
  };

  const handlePomodoroStart = (isBreak = false) => {
    const duration = isBreak ? 300 : 1500; // 5 min break, 25 min work
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'pomodoro_start',
        duration,
        isBreak,
      }));
    }
  };

  const handlePomodoroStop = () => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'pomodoro_stop' }));
    }
  };

  const handleToggleFocusMode = () => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'toggle_focus_mode' }));
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (!authToken) {
    return <AuthPage onAuth={handleAuth} />;
  }

  if (currentPage === 'rooms') {
    return <RoomsPage rooms={rooms} onJoinRoom={handleJoinRoom} onCreateRoom={handleCreateRoom} user={user} onLogout={() => {
      setAuthToken(null);
      setUser(null);
      localStorage.removeItem('authToken');
      localStorage.removeItem('user');
    }} />;
  }

  return (
    <StudyRoomPage
      room={selectedRoom}
      messages={messages}
      newMessage={newMessage}
      onMessageChange={setNewMessage}
      onSendMessage={handleSendMessage}
      members={roomMembers}
      pomodoroState={pomodoroState}
      focusMode={focusMode}
      onPomodoroStart={handlePomodoroStart}
      onPomodoroStop={handlePomodoroStop}
      onToggleFocusMode={handleToggleFocusMode}
      formatTime={formatTime}
      onLeaveRoom={() => {
        setCurrentPage('rooms');
        setSelectedRoom(null);
        setMessages([]);
      }}
    />
  );
}

function AuthPage({ onAuth }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await onAuth(email, password, isLogin);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h1>📚 Study Room</h1>
          <p>Virtual Library for Collaborative Learning</p>
        </div>

        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {error && <div className="error-message">{error}</div>}

          <button type="submit" className="auth-button">
            {isLogin ? 'Login' : 'Sign Up'}
          </button>
        </form>

        <button
          type="button"
          className="toggle-auth"
          onClick={() => setIsLogin(!isLogin)}
        >
          {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Login'}
        </button>
      </div>
    </div>
  );
}

function RoomsPage({ rooms, onJoinRoom, onCreateRoom, user, onLogout }) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [roomName, setRoomName] = useState('');

  const handleCreate = (e) => {
    e.preventDefault();
    if (roomName.trim()) {
      onCreateRoom(roomName);
      setRoomName('');
      setShowCreateModal(false);
    }
  };

  return (
    <div className="rooms-container">
      <div className="rooms-header">
        <div className="header-content">
          <h1>📚 Virtual Library</h1>
          <p>Study Rooms Available</p>
        </div>
        <button className="logout-btn" onClick={onLogout}>Logout</button>
      </div>

      <div className="rooms-grid">
        {rooms.map(room => (
          <div key={room.id} className="room-card">
            <div className="room-info">
              <h3>{room.name}</h3>
              <p className="room-meta">👥 {room.members}/{room.maxMembers}</p>
              {room.focusMode && <span className="focus-badge">🎯 Focus Mode</span>}
            </div>
            <button
              className="join-btn"
              onClick={() => onJoinRoom(room.id)}
              disabled={room.members >= room.maxMembers}
            >
              Join Room
            </button>
          </div>
        ))}

        <div className="room-card create-card" onClick={() => setShowCreateModal(true)}>
          <div className="create-content">
            <p>➕ Create New Room</p>
          </div>
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Create a Study Room</h2>
            <form onSubmit={handleCreate}>
              <input
                type="text"
                placeholder="Room name (e.g., Physics Study Group)"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                required
              />
              <button type="submit">Create Room</button>
            </form>
            <button className="close-modal" onClick={() => setShowCreateModal(false)}>
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StudyRoomPage({
  room,
  messages,
  newMessage,
  onMessageChange,
  onSendMessage,
  members,
  pomodoroState,
  focusMode,
  onPomodoroStart,
  onPomodoroStop,
  onToggleFocusMode,
  formatTime,
  onLeaveRoom,
}) {
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className={`study-room-container ${focusMode ? 'focus-mode' : ''}`}>
      <div className="study-header">
        <div className="header-left">
          <button className="back-btn" onClick={onLeaveRoom}>← Back</button>
          <h2>Study Room</h2>
        </div>
        <div className="header-right">
          <button
            className={`focus-mode-btn ${focusMode ? 'active' : ''}`}
            onClick={onToggleFocusMode}
          >
            🎯 {focusMode ? 'Focus ON' : 'Focus OFF'}
          </button>
        </div>
      </div>

      <div className="study-content">
        {/* Pomodoro Section */}
        <div className="pomodoro-section">
          <div className="pomodoro-card">
            <h3>⏱️ Pomodoro Timer</h3>
            <div className={`timer-display ${pomodoroState.isRunning ? 'running' : ''}`}>
              {formatTime(pomodoroState.timeLeft)}
            </div>
            <p className="timer-label">
              {pomodoroState.isBreak ? '☕ Break Time' : '📖 Study Time'}
            </p>
            <div className="timer-controls">
              {!pomodoroState.isRunning ? (
                <>
                  <button
                    className="timer-btn start"
                    onClick={() => onPomodoroStart(false)}
                  >
                    Start Study (25min)
                  </button>
                  <button
                    className="timer-btn break"
                    onClick={() => onPomodoroStart(true)}
                  >
                    Start Break (5min)
                  </button>
                </>
              ) : (
                <button className="timer-btn stop" onClick={onPomodoroStop}>
                  Stop Timer
                </button>
              )}
            </div>
          </div>

          {/* Members Section */}
          <div className="members-card">
            <h3>👥 Room Members</h3>
            <div className="members-list">
              {members.map(member => (
                <div key={member.id} className="member-item">
                  <span className={`status-dot ${member.status}`}></span>
                  <span>{member.username.split('@')[0]}</span>
                </div>
              ))}
            </div>
            <p className="member-count">{members.length} studying</p>
          </div>
        </div>

        {/* Chat Section */}
        <div className="chat-section">
          <div className="chat-header">
            <h3>💬 Chat</h3>
            {focusMode && <span className="focus-indicator">🔕 Focus Mode - Chat Disabled</span>}
          </div>

          <div className="messages-container">
            {messages.map(msg => (
              <div key={msg.id} className={`message ${msg.isSystem ? 'system' : ''}`}>
                <div className="message-header">
                  <span className="username">{msg.username}</span>
                  <span className="timestamp">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="message-text">{msg.text}</p>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {!focusMode && (
            <div className="message-input-container">
              <input
                type="text"
                placeholder="Type a message..."
                value={newMessage}
                onChange={(e) => onMessageChange(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && onSendMessage()}
              />
              <button onClick={onSendMessage}>Send</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
