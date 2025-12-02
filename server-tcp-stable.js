import net from 'net';
import CRC16 from 'node-crc-itu';

const PORT = 5001;

const allowedIMEIs = ['356860820045174']; // Replace with your real IMEI

const server = net.createServer((socket) => {
    console.log("📡 Tracker connected:", socket.remoteAddress);
    let buffer = Buffer.alloc(0);
    let trackerIMEI = null;

    socket.on("data", (data) => {
        buffer = Buffer.concat([buffer, data]);

        while (buffer.length >= 5 && buffer[0] === 0x78 && buffer[1] === 0x78) {
            const len = buffer[2];
            const totalLen = len + 5; // 2 start + 1 length + len + 2 end
            if (buffer.length < totalLen) break;

            const packet = buffer.slice(0, totalLen);
            buffer = buffer.slice(totalLen);

            const protocol = packet[3];
            const serial = packet.slice(totalLen - 6, totalLen - 4); // serial
            const crcReceived = packet.readUInt16BE(totalLen - 4);
            const crcCalculated = parseInt(CRC16(packet.slice(2, totalLen - 4)), 16);

            if (crcReceived !== crcCalculated) {
                console.warn("⚠️ CRC mismatch, ignoring packet");
                continue;
            }

            // Handle Login Packet
            if (protocol === 0x01) {
                const imeiBuf = packet.slice(4, 12); // IMEI in BCD format
                const imei = [...imeiBuf].map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
                trackerIMEI = imei.replace(/^0+/, ''); // remove leading zeros
                console.log("✅ IMEI:", trackerIMEI);

                // if (!allowedIMEIs.includes(trackerIMEI)) {
                //     console.log("❌ IMEI not allowed");
                //     socket.destroy();
                //     return;
                // }

                // Send Login ACK
                const ack = Buffer.from([0x78, 0x78, 0x05, 0x01, serial[0], serial[1], 0x00, 0x00, 0x0D, 0x0A]);
                const crcAck = CRC16(ack.slice(2, 6));
                ack.writeUInt16BE(parseInt(crcAck, 16), 6);
                socket.write(ack);
            }

            // Handle GPS Location Packet (Protocol 0x12)
            if (protocol === 0x12) {
                const latRaw = packet.readUInt32BE(11);
                const lonRaw = packet.readUInt32BE(15);
                const latitude = latRaw / 30000 / 60;
                const longitude = lonRaw / 30000 / 60;

                const timestamp = new Date().toISOString();

                const location = {
                    imei: trackerIMEI ?? 'UNKNOWN',
                    latitude,
                    longitude,
                    timestamp
                };

                console.log("📍 GPS Data:", location);

                // Send ACK
                const ack = Buffer.from([0x78, 0x78, 0x05, 0x12, serial[0], serial[1], 0x00, 0x00, 0x0D, 0x0A]);
                const crcAck = CRC16(ack.slice(2, 6));
                ack.writeUInt16BE(parseInt(crcAck, 16), 6);
                socket.write(ack);
            }
        }
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
