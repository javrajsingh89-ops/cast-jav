let socket;
let localStream;
let peerConnection;
let currentCode = null;
let currentStatus = 'waiting';

// Variabili per gli effetti
let isFrozen = false;
let frozenFrame = null;
let canvas = null;

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
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
            statusSubtle.textContent = 'Streaming attivo - Usa i controlli sotto';
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
        // Congela l'ultimo frame
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack && !canvas) {
            // Crea un canvas per catturare il frame
            canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Crea un elemento video temporaneo per catturare il frame
            const tempVideo = document.createElement('video');
            tempVideo.srcObject = localStream;
            tempVideo.play();
            
            tempVideo.addEventListener('loadeddata', () => {
                canvas.width = tempVideo.videoWidth;
                canvas.height = tempVideo.videoHeight;
                ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
                
                // Sostituisci la traccia video con il frame congelato
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
        // Scongela - ripristina il video live
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
    
    // Crea un canvas nero
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
    
    // Memorizza che siamo in modalità black
    blackBtn.classList.add('btn-control-active');
    blurBtn.classList.remove('btn-control-active');
    resetEffectBtn.classList.remove('btn-control-active');
}

function applyBlur() {
    if (!localStream) return;
    
    // Aggiungi filtro blur al video locale
    // Nota: per un blur perfetto serve WebGL, ma facciamo un filtro CSS sul video
    const videoElement = document.createElement('video');
    videoElement.srcObject = localStream;
    videoElement.style.filter = 'blur(10px)';
    
    // Cattura il video con blur
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

// ===== WEBRTC =====
async function initWebRTC(code) {
    peerConnection = new RTCPeerConnection(configuration);
    
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
    
    const offer = await peerConnection.createOffer();
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
    
    // Resetta effetti
    isFrozen = false;
    freezeBtn.classList.remove('btn-control-active');
    blackBtn.classList.remove('btn-control-active');
    blurBtn.classList.remove('btn-control-active');
}

async function startScreenShare() {
    try {
        updateStatus('connecting');
        
        localStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: "always",
                displaySurface: "monitor"
            },
            audio: false,
            preferCurrentTab: false
        });
        
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
        alert('Impossibile condividere lo schermo. Assicurati di utilizzare un browser compatibile (Chrome, Edge, Safari).');
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
