const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, '../public')));

// Store rooms and their participants
const rooms = new Map(); // roomCode → { teacherId, teacherName, students: Set, lessonTitle }

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

    // Broadcast updated room list to all connected students
    broadcastRoomList();
  });

  // Student joins a room
  socket.on('join-room', ({ username, roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return socket.emit('error', 'Room not found');

    room.students.add(socket.id);
    socket.join(roomCode);
    socket.emit('room-info', { lessonTitle: room.lessonTitle, teacherName: room.teacherName });

    // Notify teacher that a new student joined
    io.to(roomCode).emit('user-joined', { username, role: 'student', id: socket.id });
  });

  // Share Peer ID with everyone in the room
  socket.on('share-peer-id', ({ roomCode, peerId }) => {
    socket.to(roomCode).emit('new-peer', { peerId, senderId: socket.id });
  });

  // WebRTC signaling (offer/answer/ice)
  socket.on('signal', ({ to, type, data }) => {
    io.to(to).emit('signal', { from: socket.id, type, data });
  });

  // Chat message
  socket.on('chat', ({ roomCode, username, message }) => {
    io.to(roomCode).emit('chat', { username, message });
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
      broadcastRoomList();
    }
  });

  // Disconnect – remove user from room
  socket.on('disconnect', () => {
    for (const [roomCode, room] of rooms.entries()) {
      if (room.teacherId === socket.id) {
        // Teacher left → close room
        io.to(roomCode).emit('room-closed');
        rooms.delete(roomCode);
        broadcastRoomList();
      } else if (room.students.has(socket.id)) {
        room.students.delete(socket.id);
        io.to(roomCode).emit('user-left', socket.id);
      }
    }
  });

  // Broadcast current room list to all connected clients (for students to see)
  function broadcastRoomList() {
    const roomList = Array.from(rooms.entries()).map(([code, data]) => ({
      code,
      title: data.lessonTitle,
      teacher: data.teacherName,
      studentsCount: data.students.size
    }));
    io.emit('room-list', roomList);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
