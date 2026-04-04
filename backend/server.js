const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Secret for JWT
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// In-memory database (use MongoDB/PostgreSQL for production)
const users = new Map();
const rooms = new Map();
const userSessions = new Map();

// User authentication routes
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (users.has(email)) {
    return res.status(400).json({ error: 'User already exists' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const userId = Date.now().toString();

  users.set(email, {
    id: userId,
    username,
    email,
    password: hashedPassword,
  });

  const token = jwt.sign({ id: userId, email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: userId, username, email } });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  const user = users.get(email);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: user.id, email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, username: user.username, email } });
});

// Room management routes
app.get('/api/rooms', (req, res) => {
  const roomList = Array.from(rooms.values()).map(room => ({
    id: room.id,
    name: room.name,
    members: room.members.length,
    maxMembers: room.maxMembers,
    focusMode: room.focusMode,
  }));
  res.json(roomList);
});

app.post('/api/rooms', (req, res) => {
  const { name, maxMembers = 10 } = req.body;
  const roomId = Date.now().toString();

  rooms.set(roomId, {
    id: roomId,
    name,
    maxMembers,
    members: [],
    messages: [],
    focusMode: false,
    pomodoroState: {
      isRunning: false,
      timeLeft: 1500, // 25 minutes in seconds
      isBreak: false,
    },
  });

  res.json({ roomId });
});

app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  res.json({
    id: room.id,
    name: room.name,
    members: room.members,
    focusMode: room.focusMode,
    pomodoroState: room.pomodoroState,
    messageCount: room.messages.length,
  });
});

// WebSocket connection handling
wss.on('connection', (ws) => {
  let currentUser = null;
  let currentRoom = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'auth':
          // Verify JWT token
          try {
            const decoded = jwt.verify(message.token, JWT_SECRET);
            currentUser = decoded;
            ws.send(JSON.stringify({ type: 'auth_success', user: decoded }));
          } catch (err) {
            ws.send(JSON.stringify({ type: 'auth_error', error: 'Invalid token' }));
            ws.close();
          }
          break;

        case 'join_room':
          const room = rooms.get(message.roomId);
          if (!room) {
            ws.send(JSON.stringify({ type: 'error', error: 'Room not found' }));
            return;
          }

          if (room.members.length >= room.maxMembers) {
            ws.send(JSON.stringify({ type: 'error', error: 'Room is full' }));
            return;
          }

          currentRoom = message.roomId;
          const member = { id: currentUser.id, username: currentUser.email, status: 'studying' };
          room.members.push(member);

          // Notify all users in room
          broadcastToRoom(currentRoom, {
            type: 'user_joined',
            member,
            members: room.members,
          });

          // Send room history to new user
          ws.send(JSON.stringify({
            type: 'room_state',
            messages: room.messages.slice(-50), // Last 50 messages
            members: room.members,
            pomodoroState: room.pomodoroState,
          }));

          break;

        case 'chat_message':
          if (!currentRoom) return;
          const chatMsg = {
            id: Date.now().toString(),
            userId: currentUser.id,
            username: currentUser.email,
            text: message.text,
            timestamp: new Date().toISOString(),
          };

          rooms.get(currentRoom).messages.push(chatMsg);
          broadcastToRoom(currentRoom, {
            type: 'chat_message',
            message: chatMsg,
          });
          break;

        case 'pomodoro_start':
          if (!currentRoom) return;
          const room_p = rooms.get(currentRoom);
          room_p.pomodoroState.isRunning = true;
          room_p.pomodoroState.timeLeft = message.duration || 1500;
          room_p.pomodoroState.isBreak = message.isBreak || false;

          broadcastToRoom(currentRoom, {
            type: 'pomodoro_update',
            pomodoroState: room_p.pomodoroState,
            initiatedBy: currentUser.email,
          });
          break;

        case 'pomodoro_tick':
          if (!currentRoom) return;
          const room_t = rooms.get(currentRoom);
          room_t.pomodoroState.timeLeft -= 1;

          if (room_t.pomodoroState.timeLeft <= 0) {
            room_t.pomodoroState.isRunning = false;
          }

          broadcastToRoom(currentRoom, {
            type: 'pomodoro_tick',
            timeLeft: room_t.pomodoroState.timeLeft,
          });
          break;

        case 'pomodoro_stop':
          if (!currentRoom) return;
          rooms.get(currentRoom).pomodoroState.isRunning = false;

          broadcastToRoom(currentRoom, {
            type: 'pomodoro_stop',
          });
          break;

        case 'toggle_focus_mode':
          if (!currentRoom) return;
          rooms.get(currentRoom).focusMode = !rooms.get(currentRoom).focusMode;

          broadcastToRoom(currentRoom, {
            type: 'focus_mode_toggled',
            focusMode: rooms.get(currentRoom).focusMode,
            toggledBy: currentUser.email,
          });
          break;

        case 'user_status':
          if (!currentRoom) return;
          const room_s = rooms.get(currentRoom);
          const memberIndex = room_s.members.findIndex(m => m.id === currentUser.id);
          if (memberIndex !== -1) {
            room_s.members[memberIndex].status = message.status;
          }

          broadcastToRoom(currentRoom, {
            type: 'user_status_changed',
            userId: currentUser.id,
            status: message.status,
          });
          break;
      }
    } catch (error) {
      console.error('WebSocket error:', error);
    }
  });

  ws.on('close', () => {
    if (currentRoom && currentUser) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.members = room.members.filter(m => m.id !== currentUser.id);
        broadcastToRoom(currentRoom, {
          type: 'user_left',
          userId: currentUser.id,
          members: room.members,
        });
      }
    }
  });
});

function broadcastToRoom(roomId, message) {
  const messageStr = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      // Check if client is in this room (simplified)
      client.send(messageStr);
    }
  });
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
