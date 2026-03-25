const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, '../public')));

// Store rooms: roomCode → { teacherId, teacherName, students: Set, lessonTitle }
const rooms = new Map();

// Broadcast current room list to all connected clients
function broadcastRoomList() {
  const roomList = Array.from(rooms.entries()).map(([code, data]) => ({
    code,
    title: data.lessonTitle,
    teacher: data.teacherName,
    studentsCount: data.students.size
  }));
  io.emit('room-list', roomList);
  console.log('Broadcast room list:', roomList);
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Send current room list to the newly connected client
  broadcastRoomList();

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
    console.log(`Teacher ${username} created room ${finalCode}`);
    broadcastRoomList(); // update everyone
  });

  // Student joins a room
  socket.on('join-room', ({ username, roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return socket.emit('error', 'Room not found');

    room.students.add(socket.id);
    socket.join(roomCode);
    socket.emit('room-info', { lessonTitle: room.lessonTitle, teacherName: room.teacherName });
    console.log(`Student ${username} joined room ${roomCode}`);

    // Notify everyone in the room that a new user joined
    io.to(roomCode).emit('user-joined', { username, role: 'student', id: socket.id });
    broadcastRoomList(); // update room count
  });

  // Share Peer ID with others in the room
  socket.on('share-peer-id', ({ roomCode, peerId }) => {
    socket.to(roomCode).emit('new-peer', { peerId, senderId: socket.id });
    console.log(`Peer ID ${peerId} shared in room ${roomCode}`);
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
      console.log(`Room ${roomCode} ended by teacher`);
      broadcastRoomList();
    }
  });

  // Disconnect – remove user from room
  socket.on('disconnect', () => {
    for (const [roomCode, room] of rooms.entries()) {
      if (room.teacherId === socket.id) {
        io.to(roomCode).emit('room-closed');
        rooms.delete(roomCode);
        console.log(`Room ${roomCode} closed because teacher disconnected`);
        broadcastRoomList();
      } else if (room.students.has(socket.id)) {
        room.students.delete(socket.id);
        io.to(roomCode).emit('user-left', socket.id);
        console.log(`User ${socket.id} left room ${roomCode}`);
        broadcastRoomList();
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
