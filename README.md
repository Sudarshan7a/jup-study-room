# 📚 Online Study Room - Full Stack Project

A collaborative virtual study space where students can join study rooms, use Pomodoro timers, chat with peers, and enter focus mode for distraction-free studying.

## 🎯 Features

- **User Authentication**: Register and login with email/password
- **Virtual Rooms**: Create and join study rooms
- **Pomodoro Timer**: Built-in 25/5 work/break timer
- **Real-time Chat**: Communicate with other students in the room
- **Focus Mode**: Disable chat to minimize distractions
- **Member Tracking**: See who's studying in your room
- **Real-time Updates**: WebSocket for instant synchronization

## 🏗️ Tech Stack

### Backend
- **Node.js** - Runtime
- **Express.js** - Web framework
- **WebSocket (ws)** - Real-time communication
- **JWT** - Authentication
- **bcryptjs** - Password hashing

### Frontend
- **React** - UI framework
- **CSS3** - Styling with animations
- **WebSocket API** - Real-time updates
- **LocalStorage** - Token persistence

## 📋 Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Modern web browser

## 🚀 Installation & Setup

### Step 1: Clone the Repository

```bash
git clone <your-repo-url>
cd study-room-project
```

### Step 2: Backend Setup

```bash
# Navigate to backend directory
cd backend

# Install dependencies
npm install

# Create .env file
echo "JWT_SECRET=your-secret-key-change-in-production" > .env
echo "PORT=5000" >> .env

# Start the server
npm start
# Or for development with auto-reload
npm run dev
```

The backend will run on `http://localhost:5000`

### Step 3: Frontend Setup

```bash
# In a new terminal, navigate to frontend
cd frontend

# Install dependencies
npm install

# Start React development server
npm start
```

The frontend will open at `http://localhost:3000`

## 📁 Project Structure

```
study-room-project/
├── backend/
│   ├── server.js          # Main server file
│   ├── package.json       # Dependencies
│   └── .env               # Environment variables
├── frontend/
│   ├── src/
│   │   ├── App.jsx        # Main React component
│   │   ├── App.css        # Styling
│   │   └── index.js       # Entry point
│   ├── public/
│   │   └── index.html     # HTML template
│   └── package.json       # Dependencies
└── README.md              # This file
```

## 🔐 Authentication Flow

1. User registers with email and password
2. Password is hashed using bcryptjs
3. JWT token is generated and stored in localStorage
4. Token is sent with WebSocket connection for authentication
5. Token expires after 7 days

## 💬 Real-time Features

### WebSocket Events

**Client → Server:**
- `auth` - Authenticate user
- `join_room` - Join a study room
- `chat_message` - Send chat message
- `pomodoro_start` - Start timer
- `pomodoro_tick` - Timer tick (automatic)
- `pomodoro_stop` - Stop timer
- `toggle_focus_mode` - Toggle focus mode
- `user_status` - Update user status

**Server → Client:**
- `auth_success` / `auth_error` - Authentication result
- `room_state` - Initial room state
- `chat_message` - New chat message
- `user_joined` - Member joined
- `user_left` - Member left
- `pomodoro_update` - Timer started/updated
- `pomodoro_tick` - Timer tick
- `focus_mode_toggled` - Focus mode changed
- `user_status_changed` - User status changed

## 🎮 Usage

### Creating a Room
1. Log in with your credentials
2. Click "Create New Room"
3. Name your room (e.g., "Physics Study Group")
4. Share the room with peers

### Joining a Room
1. Browse available rooms
2. Click "Join Room"
3. Start studying!

### Using Pomodoro Timer
1. Click "Start Study (25min)" for work session
2. Focus on your studies
3. Timer notifies when break time starts
4. Use "Start Break (5min)" for rest
5. Click "Stop Timer" to cancel

### Focus Mode
1. Click "🎯 Focus ON" in header
2. Chat is disabled to minimize distractions
3. All room members know you're in focus mode
4. Click again to exit focus mode

## 🗄️ Data Models

### User
```javascript
{
  id: "unique-id",
  username: "user@email.com",
  email: "user@email.com",
  password: "hashed-password"
}
```

### Room
```javascript
{
  id: "room-id",
  name: "Physics Study Group",
  maxMembers: 10,
  members: [{ id, username, status }],
  messages: [{ id, userId, username, text, timestamp }],
  focusMode: false,
  pomodoroState: {
    isRunning: false,
    timeLeft: 1500,
    isBreak: false
  }
}
```

## 🎨 UI Features

- **Dark Theme**: Easy on the eyes for long study sessions
- **Responsive Design**: Works on desktop, tablet, and mobile
- **Smooth Animations**: Polished transitions and effects
- **Gradient Headers**: Modern visual design
- **Accessible Colors**: High contrast for readability

## 🔧 Environment Variables

Create a `.env` file in the backend directory:

```
JWT_SECRET=your-secure-secret-key-here
PORT=5000
```

## 📱 API Endpoints

### Authentication
- `POST /api/auth/register` - Create new account
- `POST /api/auth/login` - Login to account

### Rooms
- `GET /api/rooms` - Get all available rooms
- `POST /api/rooms` - Create new room
- `GET /api/rooms/:roomId` - Get room details

## 🚨 Error Handling

The application handles:
- Invalid credentials
- Room not found
- Room is full
- WebSocket disconnection
- Invalid tokens
- Network errors

## 🔒 Security Considerations

For production deployment:

1. **Database**: Replace in-memory storage with MongoDB/PostgreSQL
2. **HTTPS**: Use HTTPS instead of HTTP
3. **WSS**: Use WSS (WebSocket Secure) instead of WS
4. **CORS**: Configure CORS properly for your domain
5. **Rate Limiting**: Add rate limiting to prevent abuse
6. **Input Validation**: Validate all user inputs
7. **Helmet.js**: Add security headers
8. **Environment Variables**: Keep all secrets in .env

## 📈 Potential Enhancements

- **Video/Audio Chat**: Add peer-to-peer video
- **Screen Sharing**: Share your screen while studying
- **Study Statistics**: Track productivity metrics
- **Notifications**: Sound/desktop notifications
- **User Profiles**: User bios, achievements, streaks
- **Study Goals**: Set and track study goals
- **Leaderboard**: Community engagement
- **File Sharing**: Share study materials
- **Dark/Light Theme Toggle**: User preference
- **Multiple Languages**: Internationalization
- **Mobile App**: React Native version

## 🐛 Troubleshooting

### WebSocket Connection Failed
- Ensure backend is running on port 5000
- Check that WS_URL in App.jsx matches backend URL
- Verify CORS settings

### Messages Not Syncing
- Check browser console for errors
- Verify WebSocket connection is open
- Ensure all clients are in the same room

### Timer Not Working
- Refresh the page
- Check backend console for errors
- Verify browser supports JavaScript

### Authentication Failed
- Clear localStorage: `localStorage.clear()`
- Check .env file has JWT_SECRET
- Verify user credentials are correct

## 📚 Learning Resources

### Full Stack Development
- [MERN Stack Tutorial](https://www.mongodb.com/languages/javascript/mern-stack-tutorial)
- [Express.js Guide](https://expressjs.com/)
- [React Hooks Guide](https://react.dev/reference/react)

### WebSocket
- [MDN WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [Socket.io Tutorial](https://socket.io/docs/v4/socket-io-tutorial/)

### Authentication
- [JWT.io](https://jwt.io/)
- [bcryptjs Documentation](https://github.com/dcodeIO/bcrypt.js)

## 📄 License

MIT License - Feel free to use this project for learning and commercial purposes.

## 👥 Contributors

Built as a comprehensive full-stack learning project.

## 📞 Support

For issues or questions:
1. Check the troubleshooting section
2. Review error messages in browser console
3. Check backend logs
4. Verify all dependencies are installed

## 🎓 College Project Notes

This project demonstrates:
- ✅ Full-stack web development
- ✅ Real-time communication with WebSockets
- ✅ User authentication and authorization
- ✅ State management in React
- ✅ RESTful API design
- ✅ Database operations
- ✅ Responsive UI/UX design
- ✅ Error handling and validation
- ✅ Clean code practices

Perfect for CS/IT curriculum covering web development, networking, and databases!

---

**Happy Studying! 📖✨**
