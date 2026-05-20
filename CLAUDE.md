# אפליקציית קריוקי משפחתי — תיעוד לפיתוח עם Claude Code

## מה האפליקציה עושה

ערב קריוקי משפחתי מבוסס YouTube. שני ממשקים עובדים בסנכרון מלא:

- **Host View** (`/host`) — נפתח בטלוויזיה. מציג YouTube player במסך מלא עם overlay תחתון: מי שר עכשיו + מי הבא בתור.
- **Remote View** (`/remote`) — נפתח בנייד. מאפשר חיפוש שירים ב-YouTube, הוספה לתור, וצפייה בתור.
- **Demo** (`/karaoke.html`) — דף סטטי שמדמה את כל הממשק ללא שרת, לצורך תצוגה מוקדמת.

---

## מבנה הפרויקט

```
family-karaoke/
├── server.js              # Express + Socket.io + YouTube search API
├── package.json
├── .env.example           # צור .env עם YOUTUBE_API_KEY
├── .gitignore
├── karaoke.html           # דמו סטטי (GitHub Pages)
└── public/
    ├── index.html         # דף בחירה: Host / Remote
    ├── host.html          # ממשק מסך גדול
    └── remote.html        # ממשק נייד
```

---

## הרצה מקומית

```bash
cp .env.example .env
# ערוך .env ← הוסף YOUTUBE_API_KEY

npm install
npm start
# http://localhost:3000
```

| מכשיר | כתובת |
|-------|-------|
| TV / מסך גדול | `http://localhost:3000/host` |
| נייד (אותה WiFi) | `http://<IP-שלך>:3000/remote` |

מציאת ה-IP: `ipconfig getifaddr en0` (Mac) / `ipconfig` (Windows)

---

## טכנולוגיות

| שכבה | טכנולוגיה |
|------|-----------|
| Backend | Node.js + Express |
| Real-time | Socket.io |
| YouTube Search | YouTube Data API v3 |
| YouTube Playback | YouTube IFrame Player API |
| Frontend | Vanilla HTML/CSS/JS (ללא build step) |

---

## Socket.io Events

### Client → Server
| Event | Payload | תיאור |
|-------|---------|-------|
| `create-room` | — | Host יוצר חדר, מקבל roomId |
| `join-room` | `{ roomId, singerName }` | משתתף מצטרף |
| `add-to-queue` | `{ roomId, song }` | הוספת שיר לתור |
| `song-ended` | `{ roomId }` | Host מדווח שהשיר נגמר |
| `skip-song` | `{ roomId }` | Host מדלג לשיר הבא |
| `remove-from-queue` | `{ roomId, songId }` | הסרת שיר מהתור |

### Server → Client
| Event | Payload | תיאור |
|-------|---------|-------|
| `room-updated` | `RoomState` | עדכון מלא של מצב החדר |
| `play-song` | `QueueItem` | פקודה ל-Host לנגן וידאו |
| `host-disconnected` | — | Host התנתק |

### מבנה RoomState
```json
{
  "roomId": "ABCD",
  "participants": [{ "name": "אבא", "socketId": "..." }],
  "queue": [
    { "id": "...", "videoId": "dQw4...", "title": "...", "singerName": "דנה", "thumbnail": "..." }
  ],
  "currentlyPlaying": { /* QueueItem או null */ }
}
```

---

## מה עובד עכשיו ✅

- יצירת חדר עם קוד 4 אותיות
- הצטרפות לחדר לפי קוד + שם
- חיפוש שירים דרך YouTube API (עם fallback ל-demo songs)
- הוספת שיר לתור + הצגה בכל המכשירים בזמן אמת
- ניגון אוטומטי כשהתור מתמלא
- מעבר אוטומטי לשיר הבא כשהנוכחי נגמר
- Overlay על המסך הגדול: שם הזמר הנוכחי + הבא בתור
- Skip לשיר הבא (מהמסך הגדול)
- ניתוק משתתף / host מנוהל בצד השרת
- מצב demo ללא YouTube API key

---

## מה חסר — רשימת משימות 📋

### 🔴 חשוב לפונקציונליות מלאה

#### 1. אינטגרציית Spotify
הרעיון: המשתמש מחבר חשבון Spotify → רואה את הפלייליסטים שלו → בוחר פלייליסט → השירים מוצגים כהמלצות → לכל המלצה מחפשים קריוקי ב-YouTube.

**מה צריך לממש:**
- `GET /auth/spotify` — מפנה ל-Spotify OAuth
- `GET /auth/spotify/callback` — מקבל authorization code, שומר access token
- `GET /api/spotify/playlists` — מחזיר פלייליסטים של המשתמש
- `GET /api/spotify/playlist/:id` — מחזיר שירים מפלייליסט מסוים
- בצד לקוח: כפתור "ייבא מ-Spotify", dropdown פלייליסטים, כפתור "חפש קריוקי" ליד כל שיר

**Spotify API endpoints:**
```
GET https://api.spotify.com/v1/me/playlists
GET https://api.spotify.com/v1/playlists/{id}/tracks
```

**משתני סביבה נדרשים:**
```
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://localhost:3000/auth/spotify/callback
```

**חבילות npm:** `passport`, `passport-spotify` או `axios` ישירות.

---

#### 2. ניהול תור מהנייד
כרגע המשתתף לא יכול להסיר/לשנות שיר שהוסיף. צריך:
- כפתור מחיקה ליד שיר שהמשתתף הוסיף בעצמו
- הגבלה: כל משתתף יכול להסיר רק שירים שלו (לא של אחרים)
- שרת כבר תומך ב-`remove-from-queue` — רק צריך UI

#### 3. QR Code להצטרפות
בדף ה-Host, ליד קוד החדר, להציג QR code שמפנה ישירות ל-`/remote?room=ABCD`.
- ספרייה: `qrcode` (npm) או CDN של `qrcode.js`
- הנייד פותח מצלמה → סורק → נכנס ישירות לחדר

#### 4. שמירת שם ב-localStorage
כרגע בכל כניסה צריך להזין שוב שם + קוד. 
- שמור `{ singerName, roomId }` ב-localStorage
- בטעינה הבאה — מלא אוטומטית

---

### 🟡 שיפורים חשובים לחוויה

#### 5. Host Controls מורחבים
- כפתור Pause/Resume (לא רק Skip)
- כפתור Volume מהנייד (דרך postMessage ל-iFrame)
- גרירת שירים לשינוי סדר בתור (drag & drop)

#### 6. הגבלות תור
- מקסימום X שירים לאדם בתור בו-זמנית
- תור "הוגן" — round-robin: אחרי כל שיר עובר לאדם הבא

#### 7. היסטוריה
- רשימת שירים שהושמעו בערב הנוכחי
- "שוב אותו שיר!" — כפתור להוסיף שוב שיר מהיסטוריה

#### 8. מסך בין שירים
כשהשיר נגמר ולפני שהבא מתחיל — 5 שניות של מסך "מחיאות כפיים" עם שם הזמר.

#### 9. Emoji Reactions
בנייד: כפתורי 👏 ❤️ 🎉 שמשדרים emoji על מסך ה-Host באנימציה.

---

### 🟢 נוחות טכנית

#### 10. PWA (Progressive Web App)
- `manifest.json` ← מאפשר "הוסף למסך הבית"
- Service Worker בסיסי לטעינה מהירה
- אייקון האפליקציה

#### 11. HTTPS בייצור
YouTube IFrame מסרב לפעול ב-HTTP לאחר שינויים בדפדפן (2024+).
- הוסף הגדרות ל-nginx / reverse proxy
- או deploy ל-Railway / Render שנותנים HTTPS אוטומטי

#### 12. Persistence
כרגע כל הנתונים ברמת זיכרון ב-Node.js — server restart מוחק הכל.
- אפשרות קלה: שמור rooms ב-Redis או SQLite
- ספרייה: `ioredis` או `better-sqlite3`

---

## Spotify — מדריך מפורט

### הגדרה ב-Spotify Developer Dashboard
1. כנס ל-[developer.spotify.com](https://developer.spotify.com/dashboard)
2. Create App
3. Redirect URI: `http://localhost:3000/auth/spotify/callback`
4. העתק Client ID + Client Secret ל-`.env`

### Scopes נדרשים
```
playlist-read-private
playlist-read-collaborative
user-read-private
```

### קוד לקבל פלייליסטים (skeleton)
```javascript
// server.js — הוסף:
const SpotifyWebApi = require('spotify-web-api-node');

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI,
});

// שמור tokens per-session (או per-room)
const spotifyTokens = {}; // { socketId: { accessToken, refreshToken } }

app.get('/auth/spotify', (req, res) => {
  const scopes = ['playlist-read-private', 'playlist-read-collaborative'];
  const state = req.query.roomId || '';
  res.redirect(spotifyApi.createAuthorizeURL(scopes, state));
});

app.get('/auth/spotify/callback', async (req, res) => {
  const { code, state: roomId } = req.query;
  const data = await spotifyApi.authorizationCodeGrant(code);
  // שמור token, הפנה חזרה לאפליקציה
  res.redirect(`/remote?room=${roomId}&spotify=ok`);
});

app.get('/api/spotify/playlists', async (req, res) => {
  spotifyApi.setAccessToken(req.query.token);
  const data = await spotifyApi.getUserPlaylists();
  res.json(data.body.items.map(p => ({ id: p.id, name: p.name, total: p.tracks.total, image: p.images[0]?.url })));
});

app.get('/api/spotify/playlist/:id', async (req, res) => {
  spotifyApi.setAccessToken(req.query.token);
  const data = await spotifyApi.getPlaylistTracks(req.params.id);
  res.json(data.body.items.map(i => ({
    name: i.track.name,
    artist: i.track.artists.map(a => a.name).join(', '),
    searchQuery: `${i.track.name} ${i.track.artists[0]?.name} karaoke`
  })));
});
```

**npm:** `npm install spotify-web-api-node`

---

## Environment Variables (.env)

```
# חובה לחיפוש YouTube אמיתי
YOUTUBE_API_KEY=

# אופציונלי — Spotify
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://localhost:3000/auth/spotify/callback

# שרת
PORT=3000
```

---

## Deploy לייצור

### Railway (הכי קל)
```bash
npm install -g @railway/cli
railway login
railway init
railway up
# ← מקבל URL ציבורי עם HTTPS
```

### Render
- New Web Service → Connect GitHub repo
- Build: `npm install`
- Start: `node server.js`
- הוסף Environment Variables בממשק

### הערות לייצור
- הגדר `NODE_ENV=production`
- ב-Socket.io הוסף `transports: ['websocket', 'polling']`
- YouTube IFrame דורש HTTPS — וודא שה-`origin` ב-playerVars תואם

---

## Known Issues

1. **YouTube Embed Restrictions** — חלק מסרטונים חוסמים embed. השרת שולח `song-ended` אוטומטית אם יש שגיאת player, אבל ייתכן וידאו שנפתח כ"שגיאה שקטה". פתרון: הוסף בדיקת `videoEmbeddable: 'true'` ב-YouTube search (כבר מוטמע).

2. **חדרים לא נמחקים** — חדרים ישנים נשמרים בזיכרון עד להפעלה מחדש של השרת. הוסף timeout של 6 שעות: `setTimeout(() => delete rooms[roomId], 6 * 60 * 60 * 1000)`.

3. **YouTube Autoplay** — דפדפנים חוסמים autoplay ללא אינטראקציה. Host חייב ללחוץ משהו בדף לפני שהשיר הראשון יתנגן. כרגע: כפתור ה-skip פותר זאת, אבל אפשר להוסיף "לחץ להתחיל" overlay.

4. **Mobile Safari** — YouTube IFrame לפעמים לא מציג full-screen ב-iOS Safari. הוסף `playsinline: 1` ל-playerVars.
