const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(express.static(path.join(__dirname, '../public')));

// Store rooms: roomCode → { teacherSocketId, students: Set(socketId) }
const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Teacher creates room
  socket.on('create-room', ({ username, lessonTitle }) => {
    const roomCode = lessonTitle.replace(/\s+/g, '-').toLowerCase() || 'room-' + Date.now().toString(36);

    rooms.set(roomCode, {
      teacherId: socket.id,
      teacherName: username,
      students: new Set(),
      lessonTitle
    });

    socket.join(roomCode);
    socket.emit('room-created', { roomCode, lessonTitle });
  });

  // Student joins room
  socket.on('join-room', ({ username, roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return socket.emit('error', 'Room not found');

    room.students.add(socket.id);
    socket.join(roomCode);

    io.to(roomCode).emit('user-joined', { id: socket.id, username, role: 'student' });
    socket.emit('room-info', { lessonTitle: room.lessonTitle, teacherName: room.teacherName });
  });

  // WebRTC Signaling
  socket.on('signal', (data) => {
    io.to(data.to).emit('signal', { from: socket.id, ...data });
  });

  // Chat
  socket.on('chat', (data) => {
    io.to(data.roomCode).emit('chat', {
      sender: socket.id,
      username: data.username,
      message: data.message
    });
  });

  // Raise Hand
  socket.on('raise-hand', (data) => {
    io.to(data.roomCode).emit('hand-raised', { username: data.username });
  });

  socket.on('disconnect', () => {
    for (const [roomCode, room] of rooms.entries()) {
      if (room.teacherId === socket.id) {
        io.to(roomCode).emit('room-closed', 'Teacher left the room');
        rooms.delete(roomCode);
      } else if (room.students.has(socket.id)) {
        room.students.delete(socket.id);
        io.to(roomCode).emit('user-left', socket.id);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});