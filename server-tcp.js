import net from 'net';

const PORT = 5001;

const allowedIMEIs = [
    '356860820045174',
];

const server = net.createServer((socket) => {
    console.log("📡 Tracker connected:", socket.remoteAddress);

    socket.on("data", (data) => {

        // Detect login packet (0x01 protocol)
        if (data[0] === 0x78 && data[1] === 0x78 && data[3] === 0x01) {
            const imeiHex = data.slice(4, 12).toString('hex'); // IMEI is 8 bytes in BCD
            const imei = parseInt(imeiHex, 16).toString(); // Convert to string

            console.log("✅ IMEI Detected:", imei);

            // Optional: filter allowed devices
            if (!allowedIMEIs.includes(imei)) {
                console.log("❌ IMEI not authorized. Disconnecting.");
                socket.destroy();
                return;
            }
        }

        console.log("========================================");
        console.log("RAW BUFFER:", data);
        console.log("ASCII     :", data.toString());
        console.log("HEX       :", data.toString("hex"));
        console.log("LENGTH    :", data.length);
        console.log("========================================");
    });

    socket.on("error", (err) => {
        console.error("❗ Socket error:", err);
    });

    socket.on("close", () => {
        console.log("🔌 Tracker disconnected");
    });
});

server.listen(PORT, () => {
    console.log(`🚀 TCP Server running on port ${PORT}`);
});
