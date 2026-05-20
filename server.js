require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

const DEMO_SONGS = [
  { videoId: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up – Rick Astley (Karaoke)', channel: 'Karaoke Hits', thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg' },
  { videoId: 'L_jWHffIx5E', title: 'All Star – Smash Mouth (Karaoke)', channel: 'Karaoke Planet', thumbnail: 'https://i.ytimg.com/vi/L_jWHffIx5E/mqdefault.jpg' },
  { videoId: 'fJ9rUzIMcZQ', title: 'Bohemian Rhapsody – Queen (Karaoke)', channel: 'SingKing Karaoke', thumbnail: 'https://i.ytimg.com/vi/fJ9rUzIMcZQ/mqdefault.jpg' },
  { videoId: 'hTWKbfoikeg', title: 'Smells Like Teen Spirit – Nirvana (Karaoke)', channel: 'Karaoke Bar', thumbnail: 'https://i.ytimg.com/vi/hTWKbfoikeg/mqdefault.jpg' },
  { videoId: '09R8_2nJtjg', title: 'Sugar – Maroon 5 (Karaoke)', channel: 'Karaoke Hits HD', thumbnail: 'https://i.ytimg.com/vi/09R8_2nJtjg/mqdefault.jpg' },
  { videoId: 'JGwWNGJdvx8', title: 'Shape of You – Ed Sheeran (Karaoke)', channel: 'SingKing Karaoke', thumbnail: 'https://i.ytimg.com/vi/JGwWNGJdvx8/mqdefault.jpg' },
  { videoId: 'ktvTqknDobU', title: 'Radioactive – Imagine Dragons (Karaoke)', channel: 'Karaoke Version', thumbnail: 'https://i.ytimg.com/vi/ktvTqknDobU/mqdefault.jpg' },
  { videoId: '60ItHLz5WEA', title: 'All of Me – John Legend (Karaoke)', channel: 'Karaoke Planet', thumbnail: 'https://i.ytimg.com/vi/60ItHLz5WEA/mqdefault.jpg' },
];

app.get('/api/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing search query' });

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || apiKey === 'your_youtube_data_api_v3_key_here') {
    const query = q.toLowerCase();
    const filtered = DEMO_SONGS.filter(s => s.title.toLowerCase().includes(query));
    const results = (filtered.length ? filtered : DEMO_SONGS).map(s => ({
      ...s,
      title: `[DEMO] ${s.title}`
    }));
    return res.json(results);
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Karaoke server: http://localhost:${PORT}`));
