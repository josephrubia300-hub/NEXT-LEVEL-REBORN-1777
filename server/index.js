const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, '../public')));

// Store rooms: roomCode → { teacherId, students: Set(), lessonTitle }
const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Teacher creates a room
  socket.on('create-room', ({ username, lessonTitle }) => {
    const roomCode = lessonTitle
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    const finalCode = roomCode || `room-${Date.now().toString(36)}`;

    if (rooms.has(finalCode)) {
      return socket.emit('error', 'Room already exists');
    }

    rooms.set(finalCode, {
      teacherId: socket.id,
      teacherName: username,
      students: new Set(),
      lessonTitle
    });
    socket.join(finalCode);
    socket.emit('room-created', { roomCode: finalCode, lessonTitle });
  });

  // Student joins a room
  socket.on('join-room', ({ username, roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return socket.emit('error', 'Room not found');

    room.students.add(socket.id);
    socket.join(roomCode);
    socket.emit('room-info', { lessonTitle: room.lessonTitle });
    // Notify everyone (including teacher) that a new student joined
    io.to(roomCode).emit('user-joined', { username, role: 'student', id: socket.id });
  });

  // WebRTC signaling (PeerJS uses this)
  socket.on('signal', ({ to, type, data }) => {
    io.to(to).emit('signal', { from: socket.id, type, data });
  });

  // Chat message
  socket.on('chat', ({ roomCode, username, message }) => {
    io.to(roomCode).emit('chat', { username, message, timestamp: Date.now() });
  });

  // Raise hand
  socket.on('raise-hand', ({ roomCode, username }) => {
    io.to(roomCode).emit('hand-raised', { username });
  });

  // End class (teacher only)
  socket.on('end-class', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (room && room.teacherId === socket.id) {
      io.to(roomCode).emit('room-closed');
      rooms.delete(roomCode);
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    for (const [roomCode, room] of rooms.entries()) {
      if (room.teacherId === socket.id) {
        // Teacher left → close room
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
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
