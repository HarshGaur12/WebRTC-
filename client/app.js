// const socket = io("http://localhost:3000"); // --> this is for local testing
const socket = io.connect(window.location.origin);
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const joinBtn = document.getElementById("joinBtn");
const roomInput = document.getElementById("room");

let roomId;
let localStream;
let peerConnection;

let pendingRemoteCandidates = [];

const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: [
        "turn:relay1.expressturn.com:3478", // UDP
        "turn:relay1.expressturn.com:80",   // TCP fallback
        "turns:relay1.expressturn.com:443"  // TLS fallback
      ],
      username: "efree",         // public demo credentials
      credential: "efree"
    }
  ]
};

joinBtn.onclick = async () =>{
    roomId = roomInput.value.trim();
    if(!roomId) return alert ("Please enter a room ID");

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
    } catch (err) {
        console.error("getUserMedia error:", err);
        alert("Camera / Microphone access is required.");
        return;
    }

    socket.emit("join", roomId);
};

socket.on("ready", async (initiatorId) => {
    console.log("Room ready, initiator:", initiatorId);
    if (socket.id === initiatorId) {
      console.log("📞 I am the caller");
      if (!peerConnection) await startCall(true);
    } else {
      console.log("🎧 I am the callee");
      if (!peerConnection) await startCall(false); // set up listener connection
    }
});


socket.on("offer", async (offer) => {
    console.log("📨 Received offer");
    if(!peerConnection) await startCall(false);

    if (peerConnection.signalingState !== "stable") {
        console.warn("⚠️ Skipping offer, wrong state:", peerConnection.signalingState);
        return;
    }

    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        await flushPendingRemoteCandidates();
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit("answer", { roomId, answer });
        
    } catch (err) {
        console.error("Error handling offer:", err);
    }
});

socket.on("answer", async (answer) => {
    if (peerConnection.signalingState !== "have-local-offer") {
        console.warn("⚠️ Skipping answer, wrong state:", peerConnection.signalingState);
        return;
    }

    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        await flushPendingRemoteCandidates();
    } catch (err) {
        console.error("Error setting remote description (answer):", err);
    }
});

socket.on("ice-candidate", async (candidate) => {

    if (!peerConnection || !peerConnection.remoteDescription || !peerConnection.remoteDescription.type) {
        pendingRemoteCandidates.push(candidate);
        console.log("Queued incoming candidate (waiting for peerConnection/remoteDesc).");
        return;
  }

    try{
        await peerConnection.addIceCandidate(candidate);
    } catch(e){
        console.error("Error adding received ice candidate", e);
    }
});


socket.on("peer-disconnected", () => {
  remoteVideo.srcObject = null;
  peerConnection?.close();
  peerConnection = null;
  pendingRemoteCandidates = [];
  alert("Peer left the call.");
});

async function flushPendingRemoteCandidates() {
    if(!peerConnection) return;
    if(!pendingRemoteCandidates.length) return;
    console.log("Flushing", pendingRemoteCandidates.length, "pending remote candidates");

    for(const cand of pendingRemoteCandidates){
        try {
            await peerConnection.addIceCandidate(cand);
        } catch (err) {
            console.warn("Error while flushing candidate:", err);
        }
    }

    pendingRemoteCandidates = [];
}

async function startCall(isCaller){
    peerConnection = new RTCPeerConnection(config);

    peerConnection.onicegatheringstatechange = () => {
        console.log("ICE gathering state:", peerConnection.iceGatheringState);
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log("🌐 ICE State:", peerConnection.iceConnectionState);

        if (peerConnection.iceConnectionState === "failed") {
            console.warn("ICE failed — trying restartIce()");
            try {
                peerConnection.restartIce();
            } catch (e) {
                console.error("restartIce() error:", e);
            }
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log("📡 Connection state:", peerConnection.connectionState);
        if (peerConnection.connectionState === "failed") {
        try { peerConnection.restartIce(); } catch (e) { console.error(e); }
        }
    };

    const outgoingCandidates = [];
    let gatherComplete = false;


    peerConnection.onicecandidate = (event) => {
        if(event.candidate){
            outgoingCandidates.push(event.candidate);
            socket.emit("ice-candidate", { roomId, candidate: event.candidate });
        } else {
            gatherComplete = true;
            for(const c of outgoingCandidates){
                socket.emit("ice-candidate", { roomId, candidate: c });
            }
        }
    };

    peerConnection.ontrack = (event) => {
        console.log("📥 Got remote stream");
        remoteVideo.srcObject = event.streams[0];
    }

    if(!localStream){
        console.warn("No localStream available when starting call.");
    } else{
        localStream.getTracks().forEach((track) => {
            peerConnection.addTrack(track, localStream);
        });
    }


    if(isCaller){
        console.log("Caller waiting 700ms before creating offer...");

        await new Promise((r) => setTimeout(r, 700));
        try{
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit("offer", { roomId, offer });
            await flushPendingRemoteCandidates();
        }
        catch (err){
            console.error("Error creating/sending offer:", err);
        }
    }
}