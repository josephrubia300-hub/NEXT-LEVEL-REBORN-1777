const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, '../public')));

const rooms = new Map(); // roomCode → { teacherId, students: Set(), lessonTitle }

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('create-room', ({ username, lessonTitle }) => {
    const roomCode = lessonTitle.replace(/\s+/g, '-').toLowerCase() || 'room-' + Date.now().toString(36).slice(0,8);
    rooms.set(roomCode, {
      teacherId: socket.id,
      teacherName: username,
      students: new Set(),
      lessonTitle
    });
    socket.join(roomCode);
    socket.emit('room-created', { roomCode, lessonTitle });
  });

  socket.on('join-room', ({ username, roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return socket.emit('error', 'Room not found');

    room.students.add(socket.id);
    socket.join(roomCode);

    io.to(roomCode).emit('user-joined', { username, role: 'student' });
    socket.emit('room-info', { lessonTitle: room.lessonTitle });
  });

  // WebRTC signaling
  socket.on('signal', (data) => {
    io.to(data.to).emit('signal', { from: socket.id, type: data.type, data: data.data });
  });

  // Chat
  socket.on('chat', (data) => {
    io.to(data.roomCode).emit('chat', data);
  });

  // Raise hand
  socket.on('raise-hand', (data) => {
    io.to(data.roomCode).emit('hand-raised', data);
  });

  socket.on('disconnect', () => {
    for (const [roomCode, room] of rooms) {
      if (room.teacherId === socket.id) {
        io.to(roomCode).emit('room-closed');
        rooms.delete(roomCode);
      } else if (room.students.has(socket.id)) {
        room.students.delete(socket.id);
        io.to(roomCode).emit('user-left', socket.id);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
