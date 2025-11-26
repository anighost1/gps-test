import net from "net";

const server = net.createServer((socket) => {
    console.log("Tracker connected:", socket.remoteAddress);

    socket.on("data", (data) => {
        console.log("Received:", data.toString());
    });

    socket.on("close", () => {
        console.log("Tracker disconnected");
    });
});

server.listen(5001, () => {
    console.log("TCP Server running on port 5001");
});