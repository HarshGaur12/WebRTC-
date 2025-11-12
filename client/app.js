// const socket = io("http://localhost:3000"); // --> this is for local testing
const socket = io.connect(window.location.origin);
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const joinBtn = document.getElementById("joinBtn");
const roomInput = document.getElementById("room");

let roomId;
let localStream;
let peerConnection;

const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    // {
    //   urls: [
    //     "turns:relay1.expressturn.com:443", // TLS fallback
    //     "turn:relay1.expressturn.com:3478", // UDP
    //     "turn:relay1.expressturn.com:80",   // TCP fallback
        
    //   ],
    //   username: "efree",         // public demo credentials
    //   credential: "efree"
    // }
    {
      urls: [
        "turns:global.relay.metered.ca:443?transport=tcp",  // secure TURN (TLS)
        "turns:global.relay.metered.ca:443?transport=udp"   // secure TURN (TLS + UDP)
      ],
      username: "openaiwebrtc",
      credential: "openai123"
    }
  ]
};

joinBtn.onclick = async () =>{
    roomId = roomInput.value.trim();
    if(!roomId) return alert ("Please enter a room ID");

    localStream = await navigator.mediaDevices.getUserMedia({ video: true,  audio: true });
    localVideo.srcObject = localStream;

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

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit("answer", { roomId, answer });
});

socket.on("answer", async (answer) => {
    if (peerConnection.signalingState !== "have-local-offer") {
        console.warn("⚠️ Skipping answer, wrong state:", peerConnection.signalingState);
        return;
    }
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on("ice-candidate", async (candidate) => {
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
  alert("Peer left the call.");
});

async function startCall(isCaller){
    peerConnection = new RTCPeerConnection(config);

    peerConnection.oniceconnectionstatechange = () => {
        console.log("🌐 ICE State:", peerConnection.iceConnectionState);
        if(peerConnection.iceConnectionState === "failed"){
            console.warn("ICE failed — retrying...");
            peerConnection.restartIce();
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log("📡 Connection State:", peerConnection.connectionState);
    };


    peerConnection.onicecandidate = (event) => {
        if(event.candidate){
            socket.emit("ice-candidate", { roomId, candidate: event.candidate });
        }
    };

    peerConnection.ontrack = (event) => {
        console.log("📥 Got remote stream");
        remoteVideo.srcObject = event.streams[0];
    }

    localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
    });

    if(isCaller){
        console.log("🕒 Waiting 1 second before creating offer...");
        await new Promise(r => setTimeout(r, 1000)); 
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit("offer", { roomId, offer });
    }
}