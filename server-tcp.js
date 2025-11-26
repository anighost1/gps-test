import net from "net";

const server = net.createServer((socket) => {
    console.log("Tracker connected:", socket.remoteAddress);

    socket.on("data", (data) => {
        console.log("========================================");
        console.log("RAW BUFFER:", data);
        console.log("ASCII     :", data.toString());
        console.log("HEX       :", data.toString("hex"));
        console.log("LENGTH    :", data.length);
        console.log("========================================");
    });

    socket.on("error", (err) => {
        console.error("Socket error:", err);
    });

    socket.on("close", () => {
        console.log("Tracker disconnected");
    });
});

server.listen(5001, () => {
    console.log("TCP Server running on port 5001");
});
