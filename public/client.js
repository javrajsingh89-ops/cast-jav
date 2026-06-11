let socket;
let localStream;
let peerConnection;
let currentCode = null;
let currentStatus = 'waiting';

// Variabili per gli effetti
let isFrozen = false;
let frozenFrame = null;
let canvas = null;

// CONFIGURAZIONE WEBRTC OTTIMIZZATA PER BASSA LATENZA
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        // TURN server gratuito per migliorare la connettività
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ],
    iceCandidatePoolSize: 10,      // Più candidati = connessione più veloce
    bundlePolicy: 'max-bundle',    // Riduce il numero di connessioni
    rtcpMuxPolicy: 'require',      // Multiplexing RTCP
    sdpSemantics: 'unified-plan'   // Standard moderno
};

// DOM Elements
const shareBtn = document.getElementById('share-btn');
const endBtn = document.getElementById('end-btn');
const codeContainer = document.getElementById('code-container');
const codeDisplay = document.getElementById('code-display');
const statusText = document.getElementById('status-text');
const statusIcon = document.getElementById('status-icon');
const statusSubtle = document.getElementById('status-subtle');
const controlsContainer = document.getElementById('controls-container');
const freezeBtn = document.getElementById('freeze-btn');
const blackBtn = document.getElementById('black-btn');
const blurBtn = document.getElementById('blur-btn');
const resetEffectBtn = document.getElementById('reset-effect-btn');

function updateStatus(status, extra = {}) {
    currentStatus = status;
    
    switch(status) {
        case 'waiting':
            statusText.textContent = 'In attesa';
            statusIcon.textContent = '⏳';
            statusSubtle.textContent = 'Pronto per iniziare';
            break;
        case 'connecting':
            statusText.textContent = 'Connessione...';
            statusIcon.textContent = '🔄';
            statusSubtle.textContent = 'Attendi che la TV si connetta';
            break;
        case 'connected':
            statusText.textContent = 'Connesso';
            statusIcon.textContent = '✅';
            statusSubtle.textContent = 'TV collegata, avvio streaming...';
            break;
        case 'streaming':
            statusText.textContent = 'Trasmissione in corso';
            statusIcon.textContent = '📡';
            statusSubtle.textContent = 'Streaming fluido a 720p - Usa i controlli';
            break;
        case 'ended':
            statusText.textContent = 'Trasmissione terminata';
            statusIcon.textContent = '⏹️';
            statusSubtle.textContent = 'Puoi iniziare una nuova trasmissione';
            break;
    }
}

// ===== FUNZIONI PER GLI EFFETTI =====
function applyFreeze() {
    if (!localStream) return;
    
    if (!isFrozen) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack && !canvas) {
            canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            const tempVideo = document.createElement('video');
            tempVideo.srcObject = localStream;
            tempVideo.play();
            
            tempVideo.addEventListener('loadeddata', () => {
                canvas.width = tempVideo.videoWidth;
                canvas.height = tempVideo.videoHeight;
                ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
                
                const frozenStream = canvas.captureStream(1);
                const newVideoTrack = frozenStream.getVideoTracks()[0];
                
                const sender = peerConnection?.getSenders().find(s => s.track?.kind === 'video');
                if (sender) {
                    sender.replaceTrack(newVideoTrack);
                }
                isFrozen = true;
                freezeBtn.classList.add('btn-control-active');
                
                tempVideo.pause();
                tempVideo.srcObject = null;
            });
        }
    } else {
        const sender = peerConnection?.getSenders().find(s => s.track?.kind === 'video');
        if (sender && localStream) {
            const liveTrack = localStream.getVideoTracks()[0];
            sender.replaceTrack(liveTrack);
        }
        isFrozen = false;
        freezeBtn.classList.remove('btn-control-active');
    }
}

function applyBlack() {
    if (!localStream) return;
    
    const blackCanvas = document.createElement('canvas');
    blackCanvas.width = 640;
    blackCanvas.height = 480;
    const ctx = blackCanvas.getContext('2d');
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, blackCanvas.width, blackCanvas.height);
    
    const blackStream = blackCanvas.captureStream(1);
    const blackTrack = blackStream.getVideoTracks()[0];
    
    const sender = peerConnection?.getSenders().find(s => s.track?.kind === 'video');
    if (sender) {
        sender.replaceTrack(blackTrack);
    }
    
    blackBtn.classList.add('btn-control-active');
    blurBtn.classList.remove('btn-control-active');
    resetEffectBtn.classList.remove('btn-control-active');
}

function applyBlur() {
    if (!localStream) return;
    
    const videoElement = document.createElement('video');
    videoElement.srcObject = localStream;
    videoElement.style.filter = 'blur(10px)';
    
    const blurCanvas = document.createElement('canvas');
    blurCanvas.width = 640;
    blurCanvas.height = 480;
    const ctx = blurCanvas.getContext('2d');
    
    videoElement.play();
    videoElement.addEventListener('loadeddata', () => {
        const drawBlur = () => {
            ctx.filter = 'blur(10px)';
            ctx.drawImage(videoElement, 0, 0, blurCanvas.width, blurCanvas.height);
            requestAnimationFrame(drawBlur);
        };
        drawBlur();
    });
    
    const blurStream = blurCanvas.captureStream(30);
    const blurTrack = blurStream.getVideoTracks()[0];
    
    const sender = peerConnection?.getSenders().find(s => s.track?.kind === 'video');
    if (sender) {
        sender.replaceTrack(blurTrack);
    }
    
    blurBtn.classList.add('btn-control-active');
    blackBtn.classList.remove('btn-control-active');
    resetEffectBtn.classList.remove('btn-control-active');
}

function resetEffects() {
    if (!localStream) return;
    
    const sender = peerConnection?.getSenders().find(s => s.track?.kind === 'video');
    if (sender && localStream) {
        const liveTrack = localStream.getVideoTracks()[0];
        sender.replaceTrack(liveTrack);
    }
    
    isFrozen = false;
    freezeBtn.classList.remove('btn-control-active');
    blackBtn.classList.remove('btn-control-active');
    blurBtn.classList.remove('btn-control-active');
}

// ===== WEBRTC OTTIMIZZATO =====
async function initWebRTC(code) {
    peerConnection = new RTCPeerConnection(configuration);
    
    // Imposta le preferenze di banda con Simulcast (3 livelli di qualità)
    const transceiver = peerConnection.addTransceiver('video', {
        direction: 'sendonly',
        sendEncodings: [
            {
                rid: 'high',
                maxBitrate: 2500000,    // 2.5 Mbps - qualità alta
                scaleResolutionDownBy: 1.0,
                active: true
            },
            {
                rid: 'medium',
                maxBitrate: 1200000,    // 1.2 Mbps - qualità media
                scaleResolutionDownBy: 2.0,
                active: true
            },
            {
                rid: 'low',
                maxBitrate: 500000,     // 0.5 Mbps - qualità bassa
                scaleResolutionDownBy: 4.0,
                active: true
            }
        ]
    });
    
    // Aggiungi la traccia video
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }
    
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { code, candidate: event.candidate });
        }
    };
    
    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'connected') {
            console.log('ICE connection established');
        }
    };
    
    peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
            updateStatus('streaming');
            controlsContainer.classList.remove('hidden');
        } else if (peerConnection.connectionState === 'failed') {
            console.error('Connection failed');
            endTransmission();
        }
    };
    
    const offerOptions = {
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
        iceRestart: false
    };
    
    const offer = await peerConnection.createOffer(offerOptions);
    await peerConnection.setLocalDescription(offer);
    socket.emit('webrtc-offer', { code, offer });
}

function handleWebRTCAnswer(data) {
    if (peerConnection && data.answer) {
        peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer))
            .catch(err => console.error('Error setting answer:', err));
    }
}

function handleICECandidate(data) {
    if (peerConnection && data.candidate) {
        peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
            .catch(err => console.error('Error adding ICE candidate:', err));
    }
}

function endTransmission() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    if (socket && currentCode) {
        socket.emit('end-cast', currentCode);
    }
    
    currentCode = null;
    codeContainer.classList.add('hidden');
    controlsContainer.classList.add('hidden');
    shareBtn.classList.remove('hidden');
    endBtn.classList.add('hidden');
    updateStatus('waiting');
    
    isFrozen = false;
    freezeBtn.classList.remove('btn-control-active');
    blackBtn.classList.remove('btn-control-active');
    blurBtn.classList.remove('btn-control-active');
}

// SCREEN SHARE CON OTTIMIZZAZIONI
async function startScreenShare() {
    try {
        updateStatus('connecting');
        
        // Configurazione ottimizzata per lo screen sharing
        localStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: "always",
                displaySurface: "monitor",
                width: { ideal: 1280, max: 1920 },
                height: { ideal: 720, max: 1080 },
                frameRate: { ideal: 25, max: 30 }  // Limita a 25-30fps per stabilità
            },
            audio: false,
            preferCurrentTab: true
        });
        
        // Ottimizza la traccia video con le migliori impostazioni disponibili
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            const capabilities = videoTrack.getCapabilities();
            if (capabilities.width) {
                await videoTrack.applyConstraints({
                    width: { ideal: 1280, max: 1920 },
                    height: { ideal: 720, max: 1080 },
                    frameRate: { ideal: 25, max: 30 }
                });
            }
            console.log('Track settings:', videoTrack.getSettings());
        }
        
        localStream.getVideoTracks()[0].onended = () => {
            console.log('Screen sharing stopped by user');
            endTransmission();
        };
        
        if (!socket || !socket.connected) {
            setupSocketEvents();
        }
        
        socket.emit('phone-init');
        
    } catch (err) {
        console.error('Error sharing screen:', err);
        updateStatus('waiting');
        alert('Impossibile condividere lo schermo. Assicurati di utilizzare un browser compatibile.');
    }
}

function setupSocketEvents() {
    socket = io({
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
    });
    
    socket.on('connect', () => {
        console.log('Socket connected');
    });
    
    socket.on('code-generated', (code) => {
        currentCode = code;
        codeDisplay.textContent = code;
        codeContainer.classList.remove('hidden');
        shareBtn.classList.add('hidden');
        endBtn.classList.remove('hidden');
        updateStatus('connecting');
    });
    
    socket.on('tv-connected', async () => {
        console.log('TV connected');
        updateStatus('connected');
        if (currentCode) {
            await initWebRTC(currentCode);
        }
    });
    
    socket.on('webrtc-answer', handleWebRTCAnswer);
    socket.on('ice-candidate', handleICECandidate);
    
    socket.on('cast-ended', () => {
        console.log('Cast ended by TV');
        endTransmission();
    });
    
    socket.on('peer-disconnected', () => {
        console.log('TV disconnected');
        endTransmission();
    });
}

// Event listeners
shareBtn.addEventListener('click', startScreenShare);
endBtn.addEventListener('click', endTransmission);
freezeBtn.addEventListener('click', applyFreeze);
blackBtn.addEventListener('click', applyBlack);
blurBtn.addEventListener('click', applyBlur);
resetEffectBtn.addEventListener('click', resetEffects);

setupSocketEvents();
updateStatus('waiting');
