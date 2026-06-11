const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Configurazione CORS per Socket.IO (importante per Render)
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Servi i file statici dalla cartella public
app.use(express.static(path.join(__dirname, 'public')));

// Route per la pagina principale (smartphone)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route per la pagina TV
app.get('/tv', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tv.html'));
});

// Memorizza le sessioni di connessione
const sessions = new Map(); // key: codice a 4 cifre, value: { phoneSocketId, tvSocketId, peerInfo }

// Genera codice casuale a 4 cifre
function generateCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

io.on('connection', (socket) => {
  console.log(`Client connesso: ${socket.id}`);

  // Smartphone richiede di iniziare una sessione
  socket.on('phone-init', () => {
    let code = generateCode();
    // Assicura che il codice sia unico
    while (sessions.has(code)) {
      code = generateCode();
    }
    
    sessions.set(code, {
      phoneSocketId: socket.id,
      tvSocketId: null,
      peerInfo: null
    });
    
    socket.join(`session-${code}`);
    socket.emit('code-generated', code);
    console.log(`Sessione creata con codice: ${code}`);
  });

  // TV si connette con un codice
  socket.on('tv-connect', (code) => {
    const session = sessions.get(code);
    if (session && !session.tvSocketId) {
      session.tvSocketId = socket.id;
      socket.join(`session-${code}`);
      
      // Avvisa lo smartphone che la TV è connessa
      io.to(`session-${code}`).emit('tv-connected');
      
      socket.emit('connection-success', true);
      console.log(`TV connessa alla sessione: ${code}`);
    } else {
      socket.emit('connection-success', false);
      console.log(`Tentativo di connessione fallito per codice: ${code}`);
    }
  });

  // Offerta WebRTC dallo smartphone
  socket.on('webrtc-offer', (data) => {
    const { code, offer } = data;
    const session = sessions.get(code);
    if (session && session.tvSocketId) {
      io.to(session.tvSocketId).emit('webrtc-offer', { offer });
    }
  });

  // Risposta WebRTC dalla TV
  socket.on('webrtc-answer', (data) => {
    const { code, answer } = data;
    const session = sessions.get(code);
    if (session && session.phoneSocketId) {
      io.to(session.phoneSocketId).emit('webrtc-answer', { answer });
    }
  });

  // ICE Candidate dallo smartphone
  socket.on('ice-candidate', (data) => {
    const { code, candidate } = data;
    const session = sessions.get(code);
    if (session && session.tvSocketId) {
      io.to(session.tvSocketId).emit('ice-candidate', { candidate });
    }
  });

  // ICE Candidate dalla TV
  socket.on('ice-candidate-tv', (data) => {
    const { code, candidate } = data;
    const session = sessions.get(code);
    if (session && session.phoneSocketId) {
      io.to(session.phoneSocketId).emit('ice-candidate', { candidate });
    }
  });

  // Termina trasmissione
  socket.on('end-cast', (code) => {
    const session = sessions.get(code);
    if (session) {
      io.to(`session-${code}`).emit('cast-ended');
      io.socketsLeave(`session-${code}`);
      sessions.delete(code);
      console.log(`Trasmissione terminata per codice: ${code}`);
    }
  });

  // Disconnessione del client
  socket.on('disconnect', () => {
    console.log(`Client disconnesso: ${socket.id}`);
    // Pulizia sessioni orfane
    for (const [code, session] of sessions.entries()) {
      if (session.phoneSocketId === socket.id || session.tvSocketId === socket.id) {
        io.to(`session-${code}`).emit('peer-disconnected');
        io.socketsLeave(`session-${code}`);
        sessions.delete(code);
        console.log(`Sessione pulita per codice: ${code}`);
        break;
      }
    }
  });
});

// Render richiede l'ascolto su 0.0.0.0 e usa la porta fornita
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server in esecuzione su http://localhost:${PORT}`);
  console.log(`Pagina TV: http://localhost:${PORT}/tv`);
});
