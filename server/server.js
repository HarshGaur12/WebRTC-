import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();

app.use(cors());
app.use(express.static("../client"));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
    }
});

const rooms = new Map();

io.on("connection", (socket) =>{
    console.log(`New Socket connected: ${socket.id}`);

    socket.on("join", (roomId) =>{
        let participants = rooms.get(roomId) || [];

        if(participants.length >= 2){
            socket.emit("room_full");
            return;
        }

        participants.push(socket.id);
        rooms.set(roomId, participants);
        socket.join(roomId);
        console.log(`Socket ${socket.id} joined room ${roomId}`);

        if(participants.length === 2){
            const initiator = participants[0];
            io.to(roomId).emit("ready", initiator);
        }
    });

    socket.on("offer", ({roomId, offer }) => {
        socket.to(roomId).emit("offer", offer );
    });

    socket.on("answer", ({roomId, answer }) => {
        socket.to(roomId).emit("answer", answer );
    });

    socket.on("ice-candidate", ({roomId, candidate }) => {
        socket.to(roomId).emit("ice-candidate", candidate );
    });

    socket.on("disconnect", () => {
        for (const [roomId, members] of rooms.entries()) {
            if (members.includes(socket.id)) {
                rooms.set(roomId, members.filter(id => id !== socket.id));
                socket.to(roomId).emit("peer_disconnected");
                break;
            }
        }
    });
});

const PORT = 3000;
server.listen(PORT, "0.0.0.0" ,() => console.log(`Signaling server running on http://localhost:${PORT}`));

