import React, { useState, useEffect, useRef } from "react";
import {
  Users,
  Focus,
  Clock,
  Plus,
  LogOut,
  Send,
  ChevronLeft,
  Mic,
  MicOff,
  Video as VideoIcon,
  VideoOff,
  Trash2,
  Copy,
} from "lucide-react";
import Peer from "simple-peer";
import "./App.css";

const API_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:5000"
).replace(/\/$/, "");
const WS_URL = (
  import.meta.env.VITE_WS_URL || API_URL.replace(/^http/i, "ws")
).replace(/\/$/, "");

// Helper component for rendering peer video streams
const VideoElement = ({ peer, uniqueId, name }) => {
  const ref = useRef();
  useEffect(() => {
    const handleStream = (stream) => {
      if (ref.current) {
        ref.current.srcObject = stream;
      }
    };
    peer.on("stream", handleStream);
    return () => {
      peer.off("stream", handleStream);
    };
  }, [peer]);

  return (
    <div className="video-cell">
      <video playsInline autoPlay ref={ref} />
      <span className="video-name">{name || "Participant"}</span>
    </div>
  );
};

function App() {
  const [authToken, setAuthToken] = useState(localStorage.getItem("authToken"));
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem("user");
    return stored ? JSON.parse(stored) : null;
  });

  const [rooms, setRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [roomMembers, setRoomMembers] = useState([]);

  const [pomodoroState, setPomodoroState] = useState({
    isRunning: false,
    timeLeft: 1500,
    isBreak: false,
  });
  const [customTimeInput, setCustomTimeInput] = useState("25");
  const [focusMode, setFocusMode] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  const [isRoomReady, setIsRoomReady] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [joinCodeError, setJoinCodeError] = useState("");
  const [inviteCopyFeedback, setInviteCopyFeedback] = useState("");

  const ws = useRef(null);
  const hasAuthedRef = useRef(false);
  const pendingRoomJoinRef = useRef(null);
  const userRef = useRef(user);
  const localStreamRef = useRef(null);
  const roomMembersRef = useRef([]);

  // WebRTC States
  const [peers, setPeers] = useState([]);
  const [localStream, setLocalStream] = useState(null);
  const [micEnabled, setMicEnabled] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const peersRef = useRef([]);
  const userVideoRef = useRef(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    roomMembersRef.current = roomMembers;
  }, [roomMembers]);

  const ensureLocalStream = async () => {
    if (localStreamRef.current) {
      return localStreamRef.current;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      // Start with both tracks off; user must explicitly enable mic/camera.
      stream.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
      stream.getVideoTracks().forEach((track) => {
        track.enabled = false;
      });

      setLocalStream(stream);
      localStreamRef.current = stream;

      if (userVideoRef.current) {
        userVideoRef.current.srcObject = stream;
      }

      peersRef.current.forEach(({ peer }) => {
        try {
          peer.addStream(stream);
        } catch (error) {
          // Ignore duplicate add attempts for peers that already have this stream.
        }
      });

      return stream;
    } catch (err) {
      console.error("Failed to get local stream", err);
      return null;
    }
  };

  // Keep media off when joining; user can opt in via controls.
  const initWebRTC = () => {
    setMicEnabled(false);
    setCameraEnabled(false);
  };

  const sendJoinRoom = (roomId) => {
    if (!roomId) return;
    pendingRoomJoinRef.current = roomId;

    if (ws.current?.readyState === WebSocket.OPEN && hasAuthedRef.current) {
      ws.current.send(JSON.stringify({ type: "join_room", roomId }));
      pendingRoomJoinRef.current = null;
    }
  };

  // Toggle Media
  const toggleMic = async () => {
    const stream = localStreamRef.current || (await ensureLocalStream());
    if (!stream) return;

    const track = stream.getAudioTracks()[0];
    if (track) {
      const nextEnabled = !micEnabled;
      track.enabled = nextEnabled;
      setMicEnabled(nextEnabled);
    }
  };
  const toggleCamera = async () => {
    const stream = localStreamRef.current || (await ensureLocalStream());
    if (!stream) return;

    const track = stream.getVideoTracks()[0];
    if (track) {
      const nextEnabled = !cameraEnabled;
      track.enabled = nextEnabled;
      setCameraEnabled(nextEnabled);
    }
  };

  function createPeer(userToSignal, callerID, stream) {
    const peer = new Peer({
      initiator: true,
      trickle: false,
      ...(stream ? { stream } : {}),
    });
    peer.on("signal", (signal) => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(
          JSON.stringify({
            type: "webrtc_signal",
            targetId: userToSignal,
            signal: signal,
          }),
        );
      }
    });
    return peer;
  }

  function addPeer(incomingSignal, callerID, stream) {
    const peer = new Peer({
      initiator: false,
      trickle: false,
      ...(stream ? { stream } : {}),
    });
    peer.on("signal", (signal) => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(
          JSON.stringify({
            type: "webrtc_signal",
            targetId: callerID,
            signal: signal,
          }),
        );
      }
    });
    peer.signal(incomingSignal);
    return peer;
  }

  useEffect(() => {
    if (!authToken) return;

    ws.current = new WebSocket(WS_URL);
    hasAuthedRef.current = false;

    ws.current.onopen = () => {
      ws.current.send(JSON.stringify({ type: "auth", token: authToken }));
    };

    ws.current.onmessage = (event) => {
      const message = JSON.parse(event.data);

      switch (message.type) {
        case "auth_success":
          hasAuthedRef.current = true;
          setUser(message.user);
          if (pendingRoomJoinRef.current) {
            ws.current.send(
              JSON.stringify({
                type: "join_room",
                roomId: pendingRoomJoinRef.current,
              }),
            );
            pendingRoomJoinRef.current = null;
          }
          break;
        case "chat_message":
          setMessages((prev) => [...prev, message.message]);
          break;
        case "user_joined":
          setRoomMembers(message.members);
          setMessages((prev) => [
            ...prev,
            {
              id: "system-" + Date.now(),
              username: "System",
              text: `${message.member.username} joined the session.`,
              timestamp: new Date().toISOString(),
              isSystem: true,
            },
          ]);
          break;
        case "user_left":
          setRoomMembers(message.members);
          // Remove disconnected peer
          const peerObj = peersRef.current.find(
            (p) => p.peerID === message.userId,
          );
          if (peerObj) peerObj.peer.destroy();
          const newPeers = peersRef.current.filter(
            (p) => p.peerID !== message.userId,
          );
          peersRef.current = newPeers;
          setPeers(newPeers);

          setMessages((prev) => [
            ...prev,
            {
              id: "system-" + Date.now(),
              username: "System",
              text: `A user has left the session.`,
              timestamp: new Date().toISOString(),
              isSystem: true,
            },
          ]);
          break;
        case "pomodoro_update":
          setPomodoroState(message.pomodoroState);
          break;
        case "pomodoro_tick":
          setPomodoroState((prev) => ({
            ...prev,
            timeLeft: message.timeLeft,
            isRunning:
              message.isRunning !== undefined
                ? message.isRunning
                : prev.isRunning,
          }));
          break;
        case "pomodoro_stop":
          setPomodoroState((prev) => ({ ...prev, isRunning: false }));
          break;
        case "focus_mode_toggled":
          setFocusMode(message.focusMode);
          break;
        case "room_state":
          setMessages(message.messages);
          setRoomMembers(message.members);
          setPomodoroState(message.pomodoroState);
          setIsRoomReady(true);

          // Connect to existing members
          const membersToCall = message.members.filter(
            (m) => m.id !== userRef.current?.id,
          );
          const initialPeers = [];
          membersToCall.forEach((m) => {
            const peer = createPeer(
              m.id,
              userRef.current?.id,
              localStreamRef.current,
            );
            const peerObj = { peerID: m.id, peer, username: m.username };
            peersRef.current.push(peerObj);
            initialPeers.push(peerObj);
          });
          setPeers(initialPeers);
          break;

        case "webrtc_signal":
          // We received a signal from someone else
          const item = peersRef.current.find(
            (p) => p.peerID === message.callerId,
          );
          if (item) {
            // They sent an answer or ICE candidate
            item.peer.signal(message.signal);
          } else {
            // We received an offer from a new caller
            const newUsername =
              roomMembersRef.current.find((m) => m.id === message.callerId)
                ?.username || "Participant";
            const peer = addPeer(
              message.signal,
              message.callerId,
              localStreamRef.current,
            );
            const peerObj = {
              peerID: message.callerId,
              peer,
              username: newUsername,
            };
            peersRef.current.push(peerObj);
            setPeers([...peersRef.current]);
          }
          break;
        case "room_deleted":
          handleLeaveRoom();
          break;
      }
    };

    ws.current.onclose = () => {
      hasAuthedRef.current = false;
    };

    return () => ws.current?.close();
  }, [authToken]);

  useEffect(() => {
    if (!authToken) return;
    const fetchRooms = async () => {
      try {
        const response = await fetch(`${API_URL}/api/rooms`);
        if (response.ok) setRooms(await response.json());
      } catch (err) {}
    };
    fetchRooms();
    let interval;
    if (!selectedRoom) interval = setInterval(fetchRooms, 3000);
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [authToken, selectedRoom]);

  const handleAuth = async (email, password, username, isLogin) => {
    const endpoint = isLogin ? "/api/auth/login" : "/api/auth/register";
    const body = isLogin ? { email, password } : { email, password, username };
    const response = await fetch(`${API_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (data.token) {
      setAuthToken(data.token);
      setUser(data.user);
      localStorage.setItem("authToken", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
    } else throw new Error(data.error || "Authentication failed");
  };

  const handleLogout = () => {
    setAuthToken(null);
    setUser(null);
    setSelectedRoom(null);
    localStorage.removeItem("authToken");
    localStorage.removeItem("user");
  };

  const handleCreateRoom = async (e) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    const response = await fetch(`${API_URL}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newRoomName,
        maxMembers: 20,
        userId: user.id,
      }),
    });
    const { roomId } = await response.json();
    setNewRoomName("");
    setShowCreateModal(false);
    handleJoinRoom(roomId);
  };

  const handleJoinByCode = async (e) => {
    e.preventDefault();
    const code = joinCodeInput.trim().toUpperCase();

    if (!code) {
      setJoinCodeError("Enter an invite code");
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/rooms/join-by-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      const data = await response.json();
      if (!response.ok) {
        setJoinCodeError(data.error || "Invalid invite code");
        return;
      }

      setJoinCodeError("");
      setJoinCodeInput("");
      handleJoinRoom(data.roomId);
    } catch (error) {
      setJoinCodeError("Unable to join by code right now");
    }
  };

  const handleJoinRoom = (roomId) => {
    if (selectedRoom === roomId) return;
    setSelectedRoom(roomId);
    setIsRoomReady(false);
    setMessages([]);
    setRoomMembers([]);
    setInviteCopyFeedback("");
    setPomodoroState({ isRunning: false, timeLeft: 1500, isBreak: false });
    setFocusMode(false);

    sendJoinRoom(roomId);

    // Media is optional and should not block room join/chat/timer.
    initWebRTC();
  };

  const handleCopyInviteCode = async (code) => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setInviteCopyFeedback("Copied");
      setTimeout(() => setInviteCopyFeedback(""), 1200);
    } catch (error) {
      setInviteCopyFeedback("Copy failed");
      setTimeout(() => setInviteCopyFeedback(""), 1200);
    }
  };

  const handleLeaveRoom = () => {
    setSelectedRoom(null);
    setIsRoomReady(false);

    // Stop local media tracks to free camera
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    setLocalStream(null);
    peersRef.current.forEach((p) => p.peer.destroy());
    setPeers([]);
    peersRef.current = [];

    ws.current?.close();
    window.location.reload();
  };

  const handleDeleteRoom = async () => {
    if (!selectedRoom) return;
    try {
      await fetch(`${API_URL}/api/rooms/${selectedRoom}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
    } catch (err) {
      console.error("Failed to delete room:", err);
    }
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim() || focusMode || !isRoomReady) return;
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(
        JSON.stringify({ type: "chat_message", text: newMessage }),
      );
      setNewMessage("");
    }
  };

  const handlePomodoroStart = () => {
    if (!isRoomReady) return;
    const isBreak = customTimeInput === "5";
    const minutes = Number.parseInt(customTimeInput, 10);
    const duration = Number.isFinite(minutes)
      ? Math.max(1, minutes) * 60
      : 1500;
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(
        JSON.stringify({ type: "pomodoro_start", duration, isBreak }),
      );
    }
  };

  const handlePomodoroStop = () => {
    if (ws.current?.readyState === WebSocket.OPEN)
      ws.current.send(JSON.stringify({ type: "pomodoro_stop" }));
  };

  const handleToggleFocusMode = () => {
    if (ws.current?.readyState === WebSocket.OPEN)
      ws.current.send(JSON.stringify({ type: "toggle_focus_mode" }));
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const formatMessageTime = (timestamp) => {
    if (!timestamp) return "";
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getSenderLabel = (msg) => {
    if (msg.userId && msg.userId === user?.id) return "You";
    if (msg.username && msg.username === user?.username) return "You";
    return msg.username || "Member";
  };

  const getInitials = (name) => {
    if (!name) return "?";
    return name.substring(0, 2).toUpperCase();
  };

  if (!authToken) {
    return <AuthPage onAuth={handleAuth} />;
  }

  if (!selectedRoom) {
    return (
      <div className="luxe-app">
        <header className="luxe-header">
          <div className="luxe-brand">Focus.</div>
          <div className="luxe-user-menu">
            <span className="luxe-welcome">Hello, {user?.username}</span>
            <button onClick={handleLogout} className="luxe-btn-logout">
              <LogOut size={16} /> Logout
            </button>
          </div>
        </header>
        <main className="luxe-main">
          <div className="luxe-main-top">
            <h1 className="luxe-title">Your Study Spaces</h1>
            <button
              className="luxe-btn-primary"
              onClick={() => setShowCreateModal(true)}
            >
              <Plus size={18} style={{ marginRight: "6px" }} /> New Space
            </button>
          </div>
          <div className="luxe-card join-code-card">
            <h3>Join With Invite Code</h3>
            <form className="join-code-form" onSubmit={handleJoinByCode}>
              <input
                type="text"
                placeholder="Enter code (e.g. A1B2C3)"
                value={joinCodeInput}
                onChange={(e) => {
                  setJoinCodeInput(e.target.value.toUpperCase());
                  if (joinCodeError) setJoinCodeError("");
                }}
                maxLength={6}
              />
              <button type="submit" className="luxe-btn-primary">
                Join
              </button>
            </form>
            {joinCodeError && (
              <p className="join-code-error">{joinCodeError}</p>
            )}
          </div>
          <div className="luxe-grid">
            {rooms.map((room) => (
              <div
                key={room.id}
                className="luxe-card space-card"
                onClick={() => handleJoinRoom(room.id)}
              >
                <div className="space-icon">{getInitials(room.name)}</div>
                <div className="space-info">
                  <h3>{room.name}</h3>
                  <p>
                    {room.members} / {room.maxMembers} participants
                  </p>
                  <span className="space-code">Code: {room.inviteCode}</span>
                </div>
              </div>
            ))}
            {rooms.length === 0 && (
              <div className="luxe-empty">
                No active spaces found. Create one.
              </div>
            )}
          </div>
        </main>
        {showCreateModal && (
          <div className="luxe-modal-overlay">
            <div className="luxe-modal">
              <h2>Create a Space</h2>
              <form onSubmit={handleCreateRoom}>
                <div className="luxe-input-grp">
                  <label>Space Name</label>
                  <input
                    type="text"
                    value={newRoomName}
                    onChange={(e) => setNewRoomName(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="luxe-modal-actions">
                  <button
                    type="button"
                    className="luxe-btn-text cancel-btn"
                    onClick={() => setShowCreateModal(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="luxe-btn-primary">
                    Create
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  const activeRoomData = rooms.find((r) => r.id === selectedRoom) || {
    name: "Study Room",
  };

  return (
    <div className="luxe-app">
      <header className="luxe-header room-header">
        <button onClick={handleLeaveRoom} className="luxe-btn-text">
          <ChevronLeft size={20} /> Back
        </button>
        <h2 className="room-title">{activeRoomData.name}</h2>
        <div className="header-actions">
          <div className="invite-pill">
            <span>Code: {activeRoomData.inviteCode || "N/A"}</span>
            <button
              className="invite-copy-btn"
              onClick={() => handleCopyInviteCode(activeRoomData.inviteCode)}
            >
              <Copy size={14} />
            </button>
            {inviteCopyFeedback && (
              <span className="invite-copy-feedback">{inviteCopyFeedback}</span>
            )}
          </div>
          {activeRoomData.createdBy === user.id && (
            <button
              className="luxe-btn-danger small"
              onClick={handleDeleteRoom}
              title="Delete Room"
            >
              <Trash2 size={16} /> <span>Delete Room</span>
            </button>
          )}
          <button
            className={`luxe-focus-btn ${focusMode ? "active" : ""}`}
            onClick={handleToggleFocusMode}
          >
            <Focus size={16} /> <span>Focus Mode</span>
          </button>
        </div>
      </header>

      <main className="luxe-study-layout">
        <div className="luxe-study-side">
          {/* New Video Area */}
          <div className="luxe-card video-card">
            <h3 className="card-lbl">Current Session</h3>
            <div className="video-grid">
              <div className="video-cell local-video">
                <video muted ref={userVideoRef} autoPlay playsInline />
                <span className="video-name">You ({user?.username})</span>
              </div>

              {peers.map((peerObj, index) => (
                <VideoElement
                  key={peerObj.peerID}
                  peer={peerObj.peer}
                  uniqueId={peerObj.peerID}
                  name={peerObj.username}
                />
              ))}
            </div>

            <div className="media-controls">
              <button
                className={`media-btn ${!micEnabled ? "danger" : ""}`}
                onClick={toggleMic}
              >
                {micEnabled ? <Mic size={20} /> : <MicOff size={20} />}
              </button>
              <button
                className={`media-btn ${!cameraEnabled ? "danger" : ""}`}
                onClick={toggleCamera}
              >
                {cameraEnabled ? (
                  <VideoIcon size={20} />
                ) : (
                  <VideoOff size={20} />
                )}
              </button>
              <button
                className="media-btn danger disconnect-btn"
                onClick={handleLeaveRoom}
                title="Leave Session"
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>

          <div className="luxe-card timer-card">
            <h3 className="card-lbl">Pomodoro Timer</h3>
            <div
              className={`timer-huge ${pomodoroState.isRunning ? "running" : ""}`}
            >
              {formatTime(pomodoroState.timeLeft)}
            </div>
            <div className="timer-controls">
              {!pomodoroState.isRunning ? (
                <div className="timer-setup">
                  <div className="timer-presets">
                    <button
                      className={customTimeInput === "25" ? "active" : ""}
                      onClick={() => setCustomTimeInput("25")}
                    >
                      25m
                    </button>
                    <button
                      className={customTimeInput === "50" ? "active" : ""}
                      onClick={() => setCustomTimeInput("50")}
                    >
                      50m
                    </button>
                    <button
                      className={customTimeInput === "5" ? "active" : ""}
                      onClick={() => setCustomTimeInput("5")}
                    >
                      Break
                    </button>
                  </div>
                  <div className="custom-timer">
                    <input
                      type="number"
                      placeholder="Custom"
                      value={customTimeInput}
                      onChange={(e) => setCustomTimeInput(e.target.value)}
                      min="1"
                      max="120"
                    />
                    <span>minutes</span>
                  </div>
                  <button
                    className="luxe-btn-primary full start-timer-btn"
                    onClick={handlePomodoroStart}
                    disabled={!isRoomReady}
                  >
                    {isRoomReady ? "Start Timer" : "Joining Room..."}
                  </button>
                </div>
              ) : (
                <button
                  className="luxe-btn-danger"
                  onClick={handlePomodoroStop}
                >
                  Stop Timer
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="luxe-study-main">
          <div className={`luxe-chat-container ${focusMode ? "focused" : ""}`}>
            {focusMode && (
              <div className="luxe-focus-overlay">
                <Focus size={32} />
                <h3>Focus mode is active</h3>
                <p>Chat is temporarily hidden.</p>
              </div>
            )}
            <div className="luxe-messages">
              {messages.map((msg, i) =>
                msg.isSystem ? (
                  <div key={i} className="luxe-sys-msg">
                    {msg.text}
                  </div>
                ) : (
                  <div
                    key={i}
                    className={`luxe-msg ${msg.username === user?.username ? "own" : ""}`}
                  >
                    {msg.username !== user?.username && (
                      <div className="msg-avatar">
                        {getInitials(msg.username)}
                      </div>
                    )}
                    <div className="msg-bubble-wrapper">
                      <span className="msg-author">
                        {getSenderLabel(msg)}
                        <span className="msg-time">
                          {formatMessageTime(msg.timestamp)}
                        </span>
                      </span>
                      <div className="msg-bubble">{msg.text}</div>
                    </div>
                  </div>
                ),
              )}
            </div>
            <form className="luxe-chat-input" onSubmit={handleSendMessage}>
              <input
                type="text"
                placeholder={
                  isRoomReady ? "Type a message..." : "Joining room..."
                }
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                disabled={focusMode || !isRoomReady}
              />
              <button
                type="submit"
                disabled={focusMode || !newMessage.trim() || !isRoomReady}
              >
                <Send size={18} />
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}

function AuthPage({ onAuth }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [isLogin, setIsLogin] = useState(true);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await onAuth(email, password, username, isLogin);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="luxe-auth-wrap">
      <div className="luxe-auth-card">
        <h1 className="auth-brand">Focus.</h1>
        <p className="auth-sub">
          {isLogin ? "Sign in to continue." : "Create a space for deep work."}
        </p>
        <form onSubmit={handleSubmit} className="auth-form">
          {!isLogin && (
            <div className="luxe-input">
              <input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
          )}
          <div className="luxe-input">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="luxe-input">
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="luxe-err">{error}</p>}
          <button type="submit" className="luxe-btn-primary full">
            {isLogin ? "Sign In" : "Sign Up"}
          </button>
        </form>
        <button className="luxe-text-mode" onClick={() => setIsLogin(!isLogin)}>
          {isLogin ? "Create an account" : "Already have an account?"}
        </button>
      </div>
    </div>
  );
}

export default App;
