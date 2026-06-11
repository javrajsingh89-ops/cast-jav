const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Servi i file statici
app.use(express.static(path.join(__dirname, 'public')));

// Route per la pagina principale
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route per la pagina TV con codice opzionale
app.get('/tv', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tv.html'));
});

// Route per TV con codice diretto (es. /tv/1234)
app.get('/tv/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tv.html'));
});

const sessions = new Map();

function generateCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

io.on('connection', (socket) => {
  console.log(`Client connesso: ${socket.id}`);

  socket.on('phone-init', () => {
    let code = generateCode();
    while (sessions.has(code)) {
      code = generateCode();
    }
    
    sessions.set(code, {
      phoneSocketId: socket.id,
      tvSocketId: null
    });
    
    socket.join(`session-${code}`);
    socket.emit('code-generated', code);
    console.log(`Sessione creata con codice: ${code}`);
  });

  socket.on('tv-connect', (code) => {
    const session = sessions.get(code);
    if (session && !session.tvSocketId) {
      session.tvSocketId = socket.id;
      socket.join(`session-${code}`);
      io.to(`session-${code}`).emit('tv-connected');
      socket.emit('connection-success', true);
      console.log(`TV connessa alla sessione: ${code}`);
    } else {
      socket.emit('connection-success', false);
      console.log(`Tentativo di connessione fallito per codice: ${code}`);
    }
  });

  socket.on('webrtc-offer', (data) => {
    const { code, offer } = data;
    const session = sessions.get(code);
    if (session && session.tvSocketId) {
      io.to(session.tvSocketId).emit('webrtc-offer', { offer });
    }
  });

  socket.on('webrtc-answer', (data) => {
    const { code, answer } = data;
    const session = sessions.get(code);
    if (session && session.phoneSocketId) {
      io.to(session.phoneSocketId).emit('webrtc-answer', { answer });
    }
  });

  socket.on('ice-candidate', (data) => {
    const { code, candidate } = data;
    const session = sessions.get(code);
    if (session && session.tvSocketId) {
      io.to(session.tvSocketId).emit('ice-candidate', { candidate });
    }
  });

  socket.on('ice-candidate-tv', (data) => {
    const { code, candidate } = data;
    const session = sessions.get(code);
    if (session && session.phoneSocketId) {
      io.to(session.phoneSocketId).emit('ice-candidate', { candidate });
    }
  });

  socket.on('end-cast', (code) => {
    const session = sessions.get(code);
    if (session) {
      io.to(`session-${code}`).emit('cast-ended');
      sessions.delete(code);
      console.log(`Trasmissione terminata per codice: ${code}`);
    }
  });

  socket.on('disconnect', () => {
    for (const [code, session] of sessions.entries()) {
      if (session.phoneSocketId === socket.id || session.tvSocketId === socket.id) {
        io.to(`session-${code}`).emit('peer-disconnected');
        sessions.delete(code);
        console.log(`Sessione pulita per codice: ${code}`);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server in esecuzione su http://localhost:${PORT}`);
  console.log(`Pagina TV: http://localhost:${PORT}/tv`);
});
