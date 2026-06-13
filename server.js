require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const path = require('path');
const { router: dashboardRouter } = require('./routes/dashboard');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/dashboard', dashboardRouter);
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/remote', (req, res) => res.sendFile(path.join(__dirname, 'public', 'remote.html')));

const rooms = {};

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let id;
  do {
    id = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[id]);
  return id;
}

function sanitizeRoom(room) {
  return {
    roomId: room.roomId,
    queue: room.queue,
    currentlyPlaying: room.currentlyPlaying,
    participants: room.participants
  };
}

function playNext(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  if (room.queue.length === 0) {
    room.currentlyPlaying = null;
    io.to(roomId).emit('room-updated', sanitizeRoom(room));
    return;
  }

  const next = room.queue.shift();
  room.currentlyPlaying = next;
  io.to(roomId).emit('room-updated', sanitizeRoom(room));
  io.to(room.hostSocketId).emit('play-song', next);
}

app.get('/api/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing search query' });

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || apiKey === 'your_youtube_data_api_v3_key_here') {
    return res.status(503).json({ error: 'YouTube API key not configured. Create a .env file with YOUTUBE_API_KEY.' });
  }

  try {
    const { data } = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        q: `${q} karaoke`,
        type: 'video',
        maxResults: 10,
        videoEmbeddable: 'true',
        key: apiKey
      }
    });

    const results = data.items.map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url
    }));

    res.json(results);
  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.error?.message || err.message;
    console.error('YouTube API error:', message);
    if (status === 403) {
      res.status(403).json({ error: 'YouTube API quota exceeded or invalid key.' });
    } else {
      res.status(500).json({ error: 'Search failed: ' + message });
    }
  }
});

io.on('connection', (socket) => {
  socket.on('create-room', (cb) => {
    const roomId = generateRoomId();
    rooms[roomId] = {
      roomId,
      hostSocketId: socket.id,
      participants: [],
      queue: [],
      currentlyPlaying: null
    };
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.isHost = true;
    cb({ success: true, roomId });
  });

  socket.on('join-room', ({ roomId, singerName }, cb) => {
    const id = roomId?.toUpperCase().trim();
    const room = rooms[id];
    if (!room) return cb({ success: false, error: 'Room not found' });

    socket.join(id);
    socket.data.roomId = id;
    socket.data.singerName = singerName;
    room.participants.push({ name: singerName, socketId: socket.id });
    io.to(id).emit('room-updated', sanitizeRoom(room));
    cb({ success: true, room: sanitizeRoom(room) });
  });

  socket.on('add-to-queue', ({ roomId, song }) => {
    const room = rooms[roomId];
    if (!room) return;

    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      videoId: song.videoId,
      title: song.title,
      thumbnail: song.thumbnail,
      singerName: song.singerName
    };

    room.queue.push(item);
    io.to(roomId).emit('room-updated', sanitizeRoom(room));

    if (!room.currentlyPlaying) {
      playNext(roomId);
    }
  });

  socket.on('song-ended', ({ roomId }) => {
    const room = rooms[roomId];
    if (room && socket.id === room.hostSocketId) {
      room.currentlyPlaying = null;
      playNext(roomId);
    }
  });

  socket.on('skip-song', ({ roomId }) => {
    const room = rooms[roomId];
    if (room && socket.id === room.hostSocketId) {
      room.currentlyPlaying = null;
      playNext(roomId);
    }
  });

  socket.on('remove-from-queue', ({ roomId, songId }) => {
    const room = rooms[roomId];
    if (!room) return;
    room.queue = room.queue.filter(i => i.id !== songId);
    io.to(roomId).emit('room-updated', sanitizeRoom(room));
  });

  socket.on('disconnect', () => {
    const { roomId, isHost } = socket.data;
    if (!roomId) return;

    const room = rooms[roomId];
    if (!room) return;

    if (isHost) {
      io.to(roomId).emit('host-disconnected');
      delete rooms[roomId];
    } else {
      room.participants = room.participants.filter(p => p.socketId !== socket.id);
      io.to(roomId).emit('room-updated', sanitizeRoom(room));
    }
  });
});

// Emit socket refresh signal every 5 minutes for live dashboard updates
setInterval(() => {
  io.emit('dashboard-refresh', { timestamp: new Date().toISOString() });
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
  console.log(`  Dashboard:    http://localhost:${PORT}/dashboard`);
});
