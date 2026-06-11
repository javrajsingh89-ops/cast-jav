let socket;
let localStream;
let peerConnection;
let currentCode = null;
let currentStatus = 'waiting';

let isFrozen = false;
let originalTrack = null;
let isBlackActive = false;
let isBlurActive = false;
let blurCanvas = null;
let blurAnimationId = null;

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

const shareBtn = document.getElementById('share-btn');
const endBtn = document.getElementById('end-btn');
const codeContainer = document.getElementById('code-container');
const codeDisplay = document.getElementById('code-display');
const shareCodeBtn = document.getElementById('share-code-btn');
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
            statusSubtle.textContent = 'Streaming fluido a 720p';
            break;
        case 'ended':
            statusText.textContent = 'Trasmissione terminata';
            statusIcon.textContent = '⏹️';
            statusSubtle.textContent = 'Puoi iniziare una nuova trasmissione';
            break;
    }
}

// Condividi codice con link diretto
function shareCodeLink() {
    if (!currentCode) return;
    
    const link = `${window.location.origin}/tv/${currentCode}`;
    
    if (navigator.share) {
        navigator.share({
            title: 'Cast Jav - Codice TV',
            text: `Usa questo link per vedere il mio schermo: ${currentCode}`,
            url: link
        }).catch(err => console.log('Share cancelled:', err));
    } else {
        navigator.clipboard.writeText(link).then(() => {
            const originalText = shareCodeBtn.textContent;
            shareCodeBtn.textContent = '✅ LINK COPIATO!';
            setTimeout(() => {
                shareCodeBtn.textContent = originalText;
            }, 2000);
        }).catch(() => {
            alert('Link: ' + link);
        });
    }
}

function applyFreeze() {
    if (!peerConnection) return;
    
    const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
    if (!sender) return;
    
    if (!isFrozen) {
        originalTrack = sender.track;
        
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        
        const tempVideo = document.createElement('video');
        tempVideo.srcObject = new MediaStream([originalTrack]);
        tempVideo.muted = true;
        tempVideo.play();
        
        tempVideo.addEventListener('loadeddata', () => {
            canvas.width = tempVideo.videoWidth || 640;
            canvas.height = tempVideo.videoHeight || 480;
            ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
            
            const frozenStream = canvas.captureStream(30);
            const frozenTrack = frozenStream.getVideoTracks()[0];
            sender.replaceTrack(frozenTrack);
            isFrozen = true;
            freezeBtn.classList.add('active');
            
            tempVideo.pause();
            tempVideo.srcObject = null;
        });
    } else {
        if (originalTrack && originalTrack.readyState === 'live') {
            sender.replaceTrack(originalTrack);
        }
        isFrozen = false;
        freezeBtn.classList.remove('active');
    }
}

function applyBlack() {
    if (!peerConnection) return;
    
    const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
    if (!sender) return;
    
    if (!isBlackActive) {
        if (!isFrozen && !originalTrack) {
            originalTrack = sender.track;
        }
        
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const blackStream = canvas.captureStream(30);
        const blackTrack = blackStream.getVideoTracks()[0];
        sender.replaceTrack(blackTrack);
        
        isBlackActive = true;
        blackBtn.classList.add('active');
        blurBtn.classList.remove('active');
    }
}

function applyBlur() {
    if (!peerConnection) return;
    
    const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
    if (!sender) return;
    
    if (!isBlurActive) {
        if (!isFrozen && !originalTrack) {
            originalTrack = sender.track;
        }
        
        blurCanvas = document.createElement('canvas');
        blurCanvas.width = 640;
        blurCanvas.height = 480;
        const ctx = blurCanvas.getContext('2d');
        
        const tempVideo = document.createElement('video');
        const sourceStream = new MediaStream([originalTrack || sender.track]);
        tempVideo.srcObject = sourceStream;
        tempVideo.muted = true;
        tempVideo.play();
        
        const drawBlur = () => {
            if (!isBlurActive) return;
            if (tempVideo.videoWidth > 0) {
                blurCanvas.width = tempVideo.videoWidth;
                blurCanvas.height = tempVideo.videoHeight;
                ctx.filter = 'blur(10px)';
                ctx.drawImage(tempVideo, 0, 0, blurCanvas.width, blurCanvas.height);
            }
            blurAnimationId = requestAnimationFrame(drawBlur);
        };
        
        tempVideo.addEventListener('loadeddata', drawBlur);
        
        const blurStream = blurCanvas.captureStream(30);
        const blurTrack = blurStream.getVideoTracks()[0];
        sender.replaceTrack(blurTrack);
        
        isBlurActive = true;
        blurBtn.classList.add('active');
        blackBtn.classList.remove('active');
    }
}

function resetEffects() {
    if (!peerConnection) return;
    
    const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
    if (!sender) return;
    
    if (blurAnimationId) {
        cancelAnimationFrame(blurAnimationId);
        blurAnimationId = null;
    }
    
    if (originalTrack && originalTrack.readyState === 'live') {
        sender.replaceTrack(originalTrack);
    }
    
    isFrozen = false;
    isBlackActive = false;
    isBlurActive = false;
    
    freezeBtn.classList.remove('active');
    blackBtn.classList.remove('active');
    blurBtn.classList.remove('active');
}

async function initWebRTC(code) {
    peerConnection = new RTCPeerConnection(configuration);
    
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
            if (track.kind === 'video') {
                originalTrack = track;
            }
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
    if (blurAnimationId) {
        cancelAnimationFrame(blurAnimationId);
        blurAnimationId = null;
    }
    
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
    isBlackActive = false;
    isBlurActive = false;
    originalTrack = null;
    freezeBtn.classList.remove('active');
    blackBtn.classList.remove('active');
    blurBtn.classList.remove('active');
}

async function startScreenShare() {
    try {
        updateStatus('connecting');
        
        localStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: "always",
                displaySurface: "monitor",
                width: { ideal: 1280, max: 1920 },
                height: { ideal: 720, max: 1080 },
                frameRate: { ideal: 25, max: 30 }
            },
            audio: false,
            preferCurrentTab: false
        });
        
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            await videoTrack.applyConstraints({
                width: { ideal: 1280, max: 1920 },
                height: { ideal: 720, max: 1080 },
                frameRate: { ideal: 25, max: 30 }
            });
        }
        
        localStream.getVideoTracks()[0].onended = () => {
            endTransmission();
        };
        
        if (!socket || !socket.connected) {
            setupSocketEvents();
        }
        
        socket.emit('phone-init');
        
    } catch (err) {
        console.error('Error sharing screen:', err);
        updateStatus('waiting');
        alert('Impossibile condividere lo schermo. Assicurati di autorizzare la condivisione.');
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
        endTransmission();
    });
    
    socket.on('peer-disconnected', () => {
        endTransmission();
    });
}

shareBtn.addEventListener('click', startScreenShare);
endBtn.addEventListener('click', endTransmission);
shareCodeBtn.addEventListener('click', shareCodeLink);
freezeBtn.addEventListener('click', applyFreeze);
blackBtn.addEventListener('click', applyBlack);
blurBtn.addEventListener('click', applyBlur);
resetEffectBtn.addEventListener('click', resetEffects);

setupSocketEvents();
updateStatus('waiting');
