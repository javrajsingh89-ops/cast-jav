let socket;
let localStream;
let peerConnection;
let currentCode = null;
let currentStatus = 'waiting';

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

const shareBtn = document.getElementById('share-btn');
const endBtn = document.getElementById('end-btn');
const codeContainer = document.getElementById('code-container');
const codeDisplay = document.getElementById('code-display');
const statusText = document.getElementById('status-text');
const statusIcon = document.getElementById('status-icon');
const statusSubtle = document.getElementById('status-subtle');

function updateStatus(status, extra = {}) {
    currentStatus = status;
    
    switch(status) {
        case 'waiting':
            statusText.textContent = 'In attesa';
            statusIcon.textContent = '⏳';
            statusSubtle.textContent = 'Premi "Condividi Schermo" per iniziare';
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
            statusSubtle.textContent = 'Streaming attivo a bassa latenza';
            break;
        case 'ended':
            statusText.textContent = 'Trasmissione terminata';
            statusIcon.textContent = '⏹️';
            statusSubtle.textContent = 'Puoi iniziare una nuova trasmissione';
            break;
    }
}

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
    shareBtn.classList.remove('hidden');
    endBtn.classList.add('hidden');
    updateStatus('waiting');
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

shareBtn.addEventListener('click', startScreenShare);
endBtn.addEventListener('click', endTransmission);

setupSocketEvents();
updateStatus('waiting');
