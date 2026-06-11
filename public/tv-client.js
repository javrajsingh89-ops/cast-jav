let socket;
let peerConnection;
let currentCode = null;
let isConnected = false;
let lastTimestamp = 0;
let latencyInterval = null;

// CONFIGURAZIONE WEBRTC
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

// DOM Elements
const codeInput = document.getElementById('code-input');
const connectBtn = document.getElementById('connect-btn');
const codeInputContainer = document.getElementById('code-input-container');
const videoContainer = document.getElementById('video-container');
const remoteVideo = document.getElementById('remote-video');
const tvStatusText = document.getElementById('tv-status-text');
const tvStatusIcon = document.getElementById('tv-status-icon');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const latencyBadge = document.getElementById('latency-badge');

// Calcola e mostra la latenza
function updateLatency(latencyMs) {
    if (!latencyBadge) return;
    
    let color = '#10b981'; // verde - buona
    let text = 'Bassa';
    
    if (latencyMs > 300) {
        color = '#f59e0b'; // giallo - media
        text = 'Media';
    }
    if (latencyMs > 800) {
        color = '#ef4444'; // rosso - alta
        text = 'Alta';
    }
    
    latencyBadge.style.backgroundColor = color;
    latencyBadge.textContent = `${text} ${Math.round(latencyMs)}ms`;
    latencyBadge.classList.add('visible');
}

// Misura la latenza usando RTCP
function startLatencyMonitoring(peerConn) {
    if (latencyInterval) clearInterval(latencyInterval);
    
    latencyInterval = setInterval(() => {
        if (!peerConn) return;
        
        const stats = peerConn.getStats();
        stats.then(reports => {
            reports.forEach(report => {
                if (report.type === 'inbound-rtp' && report.kind === 'video') {
                    if (report.jitter !== undefined) {
                        // Converti jitter in latenza approssimativa
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
        } else if (container.msRequestFullscreen) {
            container.msRequestFullscreen();
        }
        fullscreenBtn.innerHTML = '⛶ Esci';
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
        fullscreenBtn.innerHTML = '⛶ Fullscreen';
    }
}

function updateFullscreenButton() {
    if (document.fullscreenElement) {
        fullscreenBtn.innerHTML = '⛶ Esci';
    } else {
        fullscreenBtn.innerHTML = '⛶ Fullscreen';
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
            
            // Avvia monitoraggio latenza
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
}

function connectToSession() {
    const code = codeInput.value.trim();
    if (!code || code.length !== 4) {
        alert('Inserisci un codice a 4 cifre valido');
        return;
    }
    
    currentCode = code;
    updateTVStatus('connecting', 'Connessione in corso...');
    
    if (!socket || !socket.connected) {
        setupSocketEvents();
    }
    
    socket.emit('tv-connect', code);
}

function setupSocketEvents() {
    socket = io({
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
    });
    
    socket.on('connect', () => {
        console.log('TV Socket connected');
    });
    
    socket.on('connection-success', (success) => {
        if (success) {
            isConnected = true;
            updateTVStatus('connected', 'Connesso!');
            initWebRTCReciever(currentCode);
        } else {
            updateTVStatus('error', 'Codice non valido');
            setTimeout(() => {
                updateTVStatus('waiting', 'In attesa codice');
            }, 2000);
            handleDisconnect();
        }
    });
    
    socket.on('webrtc-offer', handleOffer);
    socket.on('ice-candidate', handleICECandidate);
    
    socket.on('cast-ended', () => {
        handleDisconnect();
    });
    
    socket.on('peer-disconnected', () => {
        handleDisconnect();
    });
    
    socket.on('disconnect', () => {
        handleDisconnect();
    });
}

connectBtn.addEventListener('click', connectToSession);
fullscreenBtn.addEventListener('click', toggleFullscreen);

codeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        connectToSession();
    }
});

codeInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
});

setupSocketEvents();
updateTVStatus('waiting', 'In attesa codice');
