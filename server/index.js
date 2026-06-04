const express = require('express');
const https = require('https');
const fs = require('fs');
const { Server } = require('socket.io');
const path = require('path');

const app = express();

// SSL certificate
const sslOptions = {
  key: fs.readFileSync('/home/ubuntu/app/ssl/key.pem'),
  cert: fs.readFileSync('/home/ubuntu/app/ssl/cert.pem')
};

const server = https.createServer(sslOptions, app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, '../public')));

// Rest of your existing code (rooms Map, broadcastRoomList, io.on('connection'), etc.)
// ... keep everything the same from your original index.js ...

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`HTTPS Server running on https://18.192.160.55:${PORT}`);
});
