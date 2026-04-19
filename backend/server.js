const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Secret for JWT
const JWT_SECRET =
  process.env.JWT_SECRET || "your-secret-key-change-in-production";

// In-memory database (use MongoDB/PostgreSQL for production)
const users = new Map();
const rooms = new Map();
const userSessions = new Map();
const userConnections = new Map(); // added for P2P routing
const USER_DATA_PATH = path.join(__dirname, "data", "users.json");
const ROOM_DATA_PATH = path.join(__dirname, "data", "rooms.json");

async function loadUsersFromFile() {
  try {
    const file = await fs.promises.readFile(USER_DATA_PATH, "utf-8");
    const parsedUsers = JSON.parse(file);

    if (!Array.isArray(parsedUsers)) {
      console.warn("users.json is not an array; starting with empty users map");
      return;
    }

    parsedUsers.forEach((record) => {
      if (!record || !record.email || !record.id || !record.password) return;
      users.set(record.email, {
        id: record.id,
        username: record.username || record.email,
        email: record.email,
        password: record.password,
      });
    });
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Failed to read users.json:", error);
    }
  }
}

async function saveUsersToFile() {
  const usersToPersist = Array.from(users.values()).map((user) => ({
    id: user.id,
    username: user.username,
    email: user.email,
    password: user.password,
  }));

  await fs.promises.mkdir(path.dirname(USER_DATA_PATH), { recursive: true });
  await fs.promises.writeFile(
    USER_DATA_PATH,
    JSON.stringify(usersToPersist, null, 2),
    "utf-8",
  );
}

function normalizePomodoroState(pomodoroState) {
  const fallback = {
    isRunning: false,
    timeLeft: 1500,
    isBreak: false,
  };

  if (!pomodoroState || typeof pomodoroState !== "object") {
    return fallback;
  }

  return {
    isRunning: false,
    timeLeft: Number.isFinite(pomodoroState.timeLeft)
      ? pomodoroState.timeLeft
      : fallback.timeLeft,
    isBreak: Boolean(pomodoroState.isBreak),
  };
}

function serializeRoomForStorage(room) {
  return {
    id: room.id,
    name: room.name,
    inviteCode: room.inviteCode,
    maxMembers: Number.isFinite(room.maxMembers) ? room.maxMembers : 10,
    createdBy: room.createdBy || null,
    messages: Array.isArray(room.messages) ? room.messages : [],
    focusMode: Boolean(room.focusMode),
    pomodoroState: normalizePomodoroState(room.pomodoroState),
  };
}

async function loadRoomsFromFile() {
  try {
    const file = await fs.promises.readFile(ROOM_DATA_PATH, "utf-8");
    const parsedRooms = JSON.parse(file);

    if (!Array.isArray(parsedRooms)) {
      console.warn("rooms.json is not an array; starting with empty rooms map");
      return;
    }

    parsedRooms.forEach((record) => {
      if (!record || !record.id || !record.name || !record.inviteCode) return;

      const persistedRoom = serializeRoomForStorage(record);
      rooms.set(persistedRoom.id, {
        ...persistedRoom,
        members: [],
        timerInterval: null,
      });
    });
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Failed to read rooms.json:", error);
    }
  }
}

async function saveRoomsToFile() {
  const roomsToPersist = Array.from(rooms.values()).map(
    serializeRoomForStorage,
  );
  await fs.promises.mkdir(path.dirname(ROOM_DATA_PATH), { recursive: true });
  await fs.promises.writeFile(
    ROOM_DATA_PATH,
    JSON.stringify(roomsToPersist, null, 2),
    "utf-8",
  );
}

function generateInviteCode() {
  let inviteCode = "";
  do {
    inviteCode = Math.random().toString(36).slice(2, 8).toUpperCase();
  } while (
    Array.from(rooms.values()).some((room) => room.inviteCode === inviteCode)
  );
  return inviteCode;
}

function findRoomByInviteCode(code) {
  const normalized = (code || "").trim().toUpperCase();
  if (!normalized) return null;
  return (
    Array.from(rooms.values()).find((room) => room.inviteCode === normalized) ||
    null
  );
}

// User authentication routes
app.post("/api/auth/register", async (req, res) => {
  const { username, email, password } = req.body;

  if (users.has(email)) {
    return res.status(400).json({ error: "User already exists" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const userId = Date.now().toString();

  users.set(email, {
    id: userId,
    username,
    email,
    password: hashedPassword,
  });

  try {
    await saveUsersToFile();
  } catch (error) {
    users.delete(email);
    console.error("Failed to persist user credentials:", error);
    return res.status(500).json({ error: "Failed to save user data" });
  }

  const token = jwt.sign({ id: userId, email, username }, JWT_SECRET, {
    expiresIn: "7d",
  });
  res.json({ token, user: { id: userId, username, email } });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  const user = users.get(email);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign(
    { id: user.id, email, username: user.username },
    JWT_SECRET,
    { expiresIn: "7d" },
  );
  res.json({ token, user: { id: user.id, username: user.username, email } });
});

// Room management routes
app.get("/api/rooms", (req, res) => {
  const roomList = Array.from(rooms.values()).map((room) => ({
    id: room.id,
    name: room.name,
    inviteCode: room.inviteCode,
    createdBy: room.createdBy,
    members: room.members.length,
    maxMembers: room.maxMembers,
    focusMode: room.focusMode,
  }));
  res.json(roomList);
});

app.post("/api/rooms", async (req, res) => {
  const { name, maxMembers = 10, userId } = req.body;
  const roomId = Date.now().toString();
  const inviteCode = generateInviteCode();

  rooms.set(roomId, {
    id: roomId,
    name,
    inviteCode,
    maxMembers,
    createdBy: userId,
    members: [],
    messages: [],
    focusMode: false,
    pomodoroState: {
      isRunning: false,
      timeLeft: 1500, // 25 minutes in seconds
      isBreak: false,
    },
  });

  try {
    await saveRoomsToFile();
  } catch (error) {
    rooms.delete(roomId);
    console.error("Failed to persist room:", error);
    return res.status(500).json({ error: "Failed to save room data" });
  }

  res.json({ roomId, inviteCode });
});

app.post("/api/rooms/join-by-code", (req, res) => {
  const code = req.body?.code;
  const room = findRoomByInviteCode(code);

  if (!room) {
    return res.status(404).json({ error: "Invite code not found" });
  }

  if (room.members.length >= room.maxMembers) {
    return res.status(400).json({ error: "Room is full" });
  }

  res.json({
    roomId: room.id,
    roomName: room.name,
    inviteCode: room.inviteCode,
    members: room.members.length,
    maxMembers: room.maxMembers,
  });
});

app.delete("/api/rooms/:roomId", async (req, res) => {
  const room = rooms.get(req.params.roomId);
  const { userId } = req.body;

  if (!room) return res.status(404).json({ error: "Room not found" });
  if (room.createdBy !== userId)
    return res
      .status(403)
      .json({ error: "Only the host can delete this room" });

  // Notify everyone in the room to leave
  broadcastToRoom(req.params.roomId, { type: "room_deleted" });

  if (room.timerInterval) clearInterval(room.timerInterval);
  rooms.delete(req.params.roomId);

  try {
    await saveRoomsToFile();
  } catch (error) {
    console.error("Failed to persist room deletion:", error);
    return res
      .status(500)
      .json({ error: "Room deleted but failed to update storage" });
  }

  res.json({ success: true });
});

app.get("/api/rooms/:roomId", (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }

  res.json({
    id: room.id,
    name: room.name,
    inviteCode: room.inviteCode,
    members: room.members,
    focusMode: room.focusMode,
    pomodoroState: room.pomodoroState,
    messageCount: room.messages.length,
  });
});

// WebSocket connection handling
wss.on("connection", (ws) => {
  let currentUser = null;
  let currentRoom = null;

  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case "auth":
          // Verify JWT token
          try {
            const decoded = jwt.verify(message.token, JWT_SECRET);
            currentUser = decoded;
            userConnections.set(currentUser.id, ws);
            ws.send(JSON.stringify({ type: "auth_success", user: decoded }));
          } catch (err) {
            ws.send(
              JSON.stringify({ type: "auth_error", error: "Invalid token" }),
            );
            ws.close();
          }
          break;

        case "join_room":
          if (!currentUser) {
            ws.send(
              JSON.stringify({
                type: "error",
                error: "Please authenticate before joining a room",
              }),
            );
            return;
          }

          const room = rooms.get(message.roomId);
          if (!room) {
            ws.send(JSON.stringify({ type: "error", error: "Room not found" }));
            return;
          }

          if (room.members.length >= room.maxMembers) {
            ws.send(JSON.stringify({ type: "error", error: "Room is full" }));
            return;
          }

          if (currentRoom && currentRoom !== message.roomId) {
            const previousRoom = rooms.get(currentRoom);
            if (previousRoom) {
              previousRoom.members = previousRoom.members.filter(
                (m) => m.id !== currentUser.id,
              );
              broadcastToRoom(currentRoom, {
                type: "user_left",
                userId: currentUser.id,
                members: previousRoom.members,
              });
            }
          }

          currentRoom = message.roomId;

          let member = room.members.find((m) => m.id === currentUser.id);
          if (!member) {
            member = {
              id: currentUser.id,
              username: currentUser.username,
              status: "studying",
            };
            room.members.push(member);
          }

          // Send room history to new user first so join UI can render immediately.
          ws.send(
            JSON.stringify({
              type: "room_state",
              messages: room.messages.slice(-50), // Last 50 messages
              members: room.members,
              pomodoroState: room.pomodoroState,
            }),
          );

          // Notify the rest of the room after the joining user is ready.
          broadcastToRoom(
            currentRoom,
            {
              type: "user_joined",
              member,
              members: room.members,
            },
            { excludeUserId: currentUser.id },
          );

          break;

        case "chat_message":
          if (!currentRoom) return;
          const chatMsg = {
            id: Date.now().toString(),
            userId: currentUser.id,
            username: currentUser.username,
            text: message.text,
            timestamp: new Date().toISOString(),
          };

          rooms.get(currentRoom).messages.push(chatMsg);
          broadcastToRoom(currentRoom, {
            type: "chat_message",
            message: chatMsg,
          });

          await saveRoomsToFile();
          break;

        case "pomodoro_start":
          if (!currentRoom) return;
          const room_p = rooms.get(currentRoom);
          if (room_p.timerInterval) clearInterval(room_p.timerInterval);

          room_p.pomodoroState.isRunning = true;
          room_p.pomodoroState.timeLeft = message.duration || 1500;
          room_p.pomodoroState.isBreak = message.isBreak || false;

          room_p.timerInterval = setInterval(() => {
            room_p.pomodoroState.timeLeft -= 1;
            if (room_p.pomodoroState.timeLeft <= 0) {
              room_p.pomodoroState.isRunning = false;
              clearInterval(room_p.timerInterval);
            }
            broadcastToRoom(currentRoom, {
              type: "pomodoro_tick",
              timeLeft: room_p.pomodoroState.timeLeft,
              isRunning: room_p.pomodoroState.isRunning,
            });
          }, 1000);

          broadcastToRoom(currentRoom, {
            type: "pomodoro_update",
            pomodoroState: room_p.pomodoroState,
            initiatedBy: currentUser.username,
          });

          await saveRoomsToFile();
          break;

        case "pomodoro_tick":
          // Handled by backend interval now
          break;

        case "pomodoro_stop":
          if (!currentRoom) return;
          const currentRoomObj = rooms.get(currentRoom);
          currentRoomObj.pomodoroState.isRunning = false;
          if (currentRoomObj.timerInterval) {
            clearInterval(currentRoomObj.timerInterval);
          }

          broadcastToRoom(currentRoom, {
            type: "pomodoro_stop",
          });

          await saveRoomsToFile();
          break;

        case "toggle_focus_mode":
          if (!currentRoom) return;
          rooms.get(currentRoom).focusMode = !rooms.get(currentRoom).focusMode;

          broadcastToRoom(currentRoom, {
            type: "focus_mode_toggled",
            focusMode: rooms.get(currentRoom).focusMode,
            toggledBy: currentUser.username,
          });

          await saveRoomsToFile();
          break;

        case "user_status":
          if (!currentRoom) return;
          const room_s = rooms.get(currentRoom);
          const memberIndex = room_s.members.findIndex(
            (m) => m.id === currentUser.id,
          );
          if (memberIndex !== -1) {
            room_s.members[memberIndex].status = message.status;
          }

          broadcastToRoom(currentRoom, {
            type: "user_status_changed",
            userId: currentUser.id,
            status: message.status,
          });
          break;

        case "webrtc_signal":
          const targetWs = userConnections.get(message.targetId);
          if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            targetWs.send(
              JSON.stringify({
                type: "webrtc_signal",
                callerId: currentUser.id,
                signal: message.signal,
              }),
            );
          }
          break;
      }
    } catch (error) {
      console.error("WebSocket error:", error);
    }
  });

  ws.on("close", () => {
    if (currentUser) {
      userConnections.delete(currentUser.id);
    }
    if (currentRoom && currentUser) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.members = room.members.filter((m) => m.id !== currentUser.id);
        broadcastToRoom(currentRoom, {
          type: "user_left",
          userId: currentUser.id,
          members: room.members,
        });
      }
    }
  });
});

function broadcastToRoom(roomId, message, options = {}) {
  const room = rooms.get(roomId);
  if (!room) return;
  const messageStr = JSON.stringify(message);
  const excludeUserId = options.excludeUserId;

  room.members = room.members.filter((member) => {
    if (excludeUserId && member.id === excludeUserId) {
      return true;
    }

    const client = userConnections.get(member.id);
    if (client && client.readyState === WebSocket.OPEN) {
      try {
        client.send(messageStr);
        return true;
      } catch (error) {
        console.warn(`Failed to send message to user ${member.id}:`, error);
        userConnections.delete(member.id);
        return false;
      }
    }

    return false;
  });
}

const PORT = process.env.PORT || 5000;
async function startServer() {
  await loadUsersFromFile();
  await loadRoomsFromFile();
  console.log(`Loaded ${users.size} saved user(s)`);
  console.log(`Loaded ${rooms.size} saved room(s)`);

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Server failed to start:", error);
  process.exit(1);
});
