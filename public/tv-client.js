let socket;
let peerConnection;
let currentCode = null;
let isConnected = false;
let latencyInterval = null;

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
    ],
    iceCandidatePoolSize: 10,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    sdpSemantics: 'unified-plan'
};

const codeInput = document.getElementById('code-input');
const connectBtn = document.getElementById('connect-btn');
const codeInputContainer = document.getElementById('code-input-container');
const videoContainer = document.getElementById('video-container');
const remoteVideo = document.getElementById('remote-video');
const tvStatusText = document.getElementById('tv-status-text');
const tvStatusIcon = document.getElementById('tv-status-icon');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const latencyBadge = document.getElementById('latency-badge');

// Estrai codice dall'URL
function getCodeFromURL() {
    const path = window.location.pathname;
    const match = path.match(/\/tv\/(\d{4})/);
    if (match) {
        return match[1];
    }
    return null;
}

// Aggiorna URL con il codice (senza ricaricare)
function updateURLWithCode(code) {
    if (!code) return;
    const newUrl = `${window.location.origin}/tv/${code}`;
    window.history.replaceState({ code: code }, '', newUrl);
}

// Rimuovi codice dall'URL (quando la sessione finisce)
function removeCodeFromURL() {
    const newUrl = `${window.location.origin}/tv`;
    window.history.replaceState({}, '', newUrl);
}

function updateLatency(latencyMs) {
    if (!latencyBadge) return;
    
    let color = '#10b981';
    let text = 'BASSA';
    
    if (latencyMs > 300) {
        color = '#f59e0b';
        text = 'MEDIA';
    }
    if (latencyMs > 800) {
        color = '#ef4444';
        text = 'ALTA';
    }
    
    latencyBadge.style.backgroundColor = color;
    latencyBadge.textContent = `${text} ${Math.round(latencyMs)}ms`;
    latencyBadge.classList.add('visible');
}

function startLatencyMonitoring(peerConn) {
    if (latencyInterval) clearInterval(latencyInterval);
    
    latencyInterval = setInterval(() => {
        if (!peerConn) return;
        
        peerConn.getStats().then(reports => {
            reports.forEach(report => {
                if (report.type === 'inbound-rtp' && report.kind === 'video') {
                    if (report.jitter !== undefined) {
                        const estimatedLatency = report.jitter * 1000;
                        updateLatency(estimatedLatency);
                    }
                }
            });
        }).catch(err => console.log('Stats error:', err));
    }, 2000);
}

function stopLatencyMonitoring() {
    if (latencyInterval) {
        clearInterval(latencyInterval);
        latencyInterval = null;
    }
    if (latencyBadge) {
        latencyBadge.classList.remove('visible');
    }
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        const container = videoContainer;
        if (container.requestFullscreen) {
            container.requestFullscreen();
        } else if (container.webkitRequestFullscreen) {
            container.webkitRequestFullscreen();
        }
        fullscreenBtn.innerHTML = '⛶ ESC';
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
        fullscreenBtn.innerHTML = '⛶ FULLSCREEN';
    }
}

function updateFullscreenButton() {
    if (document.fullscreenElement) {
        fullscreenBtn.innerHTML = '⛶ ESC';
    } else {
        fullscreenBtn.innerHTML = '⛶ FULLSCREEN';
    }
}

document.addEventListener('fullscreenchange', updateFullscreenButton);
document.addEventListener('webkitfullscreenchange', updateFullscreenButton);

function updateTVStatus(status, message) {
    tvStatusText.textContent = message || status;
    switch(status) {
        case 'waiting':
            tvStatusIcon.textContent = '📺';
            break;
        case 'connecting':
            tvStatusIcon.textContent = '🔄';
            break;
        case 'connected':
            tvStatusIcon.textContent = '✅';
            break;
        case 'streaming':
            tvStatusIcon.textContent = '📡';
            break;
        case 'error':
            tvStatusIcon.textContent = '❌';
            break;
    }
}

async function initWebRTCReciever(code) {
    peerConnection = new RTCPeerConnection(configuration);
    
    peerConnection.ontrack = (event) => {
        console.log('Received remote track');
        if (event.streams && event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            remoteVideo.play().catch(e => console.log('Play error:', e));
            
            videoContainer.classList.remove('hidden');
            codeInputContainer.classList.add('hidden');
            fullscreenBtn.classList.remove('hidden');
            updateTVStatus('streaming', 'Streaming in corso');
            
            startLatencyMonitoring(peerConnection);
        }
    };
    
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate-tv', { code, candidate: event.candidate });
        }
    };
    
    peerConnection.onconnectionstatechange = () => {
        console.log('TV Connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
            updateTVStatus('streaming', 'Streaming in corso');
        } else if (peerConnection.connectionState === 'failed') {
            handleDisconnect();
        }
    };
}

function handleOffer(data) {
    if (peerConnection && data.offer) {
        peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer))
            .then(() => peerConnection.createAnswer())
            .then(answer => peerConnection.setLocalDescription(answer))
            .then(() => {
                socket.emit('webrtc-answer', { code: currentCode, answer: peerConnection.localDescription });
            })
            .catch(err => console.error('Error:', err));
    }
}

function handleICECandidate(data) {
    if (peerConnection && data.candidate) {
        peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
            .catch(err => console.error('Error adding ICE candidate:', err));
    }
}

function handleDisconnect() {
    stopLatencyMonitoring();
    
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    remoteVideo.srcObject = null;
    videoContainer.classList.add('hidden');
    codeInputContainer.classList.remove('hidden');
    fullscreenBtn.classList.add('hidden');
    codeInput.value = '';
    isConnected = false;
    currentCode = null;
    updateTVStatus('waiting', 'In attesa codice');
    
    // Rimuovi il codice dall'URL
    removeCodeFromURL();
}

function connectToSession(code) {
    if (!code || code.length !== 4) {
        updateTVStatus('error', 'Codice non valido');
        setTimeout(() => {
            updateTVStatus('waiting', 'In attesa codice');
        }, 2000);
        return;
    }
    
    currentCode = code;
    updateURLWithCode(code);  // Mantieni il codice nell'URL
    updateTVStatus('connecting', 'Connessione in corso...');
    
    if (!socket || !socket.connected) {
        setupSocketEvents();
    } else {
        socket.emit('tv-connect', code);
    }
}

function setupSocketEvents() {
    if (socket) {
        // Rimuovi vecchi listener per evitare duplicati
        socket.removeAllListeners();
    }
    
    socket = io({
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
    });
    
    socket.on('connect', () => {
        console.log('TV Socket connected');
        if (currentCode) {
            socket.emit('tv-connect', currentCode);
        }
    });
    
    socket.on('connection-success', (success) => {
        if (success) {
            isConnected = true;
            updateTVStatus('connected', 'Connesso!');
            initWebRTCReciever(currentCode);
        } else {
            updateTVStatus('error', 'Codice non valido o sessione scaduta');
            setTimeout(() => {
                if (!isConnected) {
                    updateTVStatus('waiting', 'In attesa codice');
                    // Non rimuovere il codice dall'URL automaticamente, lascia che l'utente riprovi
                }
            }, 2000);
        }
    });
    
    socket.on('webrtc-offer', handleOffer);
    socket.on('ice-candidate', handleICECandidate);
    
    socket.on('cast-ended', () => {
        console.log('Cast ended by sender');
        handleDisconnect();
    });
    
    socket.on('peer-disconnected', () => {
        console.log('Sender disconnected');
        updateTVStatus('error', 'Il mittente ha terminato la trasmissione');
        setTimeout(() => {
            handleDisconnect();
        }, 2000);
    });
    
    socket.on('disconnect', () => {
        console.log('Socket disconnected');
        if (isConnected) {
            updateTVStatus('error', 'Connessione persa, riconnessione...');
        }
    });
}

// Event listeners
connectBtn.addEventListener('click', () => {
    const code = codeInput.value.trim();
    if (!code || code.length !== 4) {
        alert('Inserisci un codice a 4 cifre valido');
        return;
    }
    connectToSession(code);
});

fullscreenBtn.addEventListener('click', toggleFullscreen);

codeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const code = codeInput.value.trim();
        if (code && code.length === 4) {
            connectToSession(code);
        }
    }
});

// Animazione quando si digita
codeInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
    
    // Effetto visivo sulla cifra inserita
    e.target.style.transform = 'scale(1.02)';
    setTimeout(() => {
        e.target.style.transform = 'scale(1)';
    }, 100);
});

// Inizializza
setupSocketEvents();
updateTVStatus('waiting', 'In attesa codice');

// Controlla se c'è un codice nell'URL all'avvio
const urlCode = getCodeFromURL();
if (urlCode) {
    console.log('Codice trovato in URL:', urlCode);
    codeInput.value = urlCode;
    connectToSession(urlCode);
}

// Ascolta il back/forward del browser
window.addEventListener('popstate', (event) => {
    const newCode = getCodeFromURL();
    if (newCode && newCode !== currentCode && !isConnected) {
        codeInput.value = newCode;
        connectToSession(newCode);
    } else if (!newCode && isConnected) {
        // Se l'utente torna indietro mentre è connesso, non disconnettere
        // ma ripristina il codice nell'URL
        if (currentCode) {
            updateURLWithCode(currentCode);
        }
    }
});
