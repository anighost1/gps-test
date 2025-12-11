import net from "net";
import CRC16 from "node-crc-itu";
import { createClient } from "redis";

// Redis Publisher
const redis = createClient({
    url: process.env.REDIS_URL || "redis://127.0.0.1:6379",
});
redis.connect();

const PORT = 5000;

// ========= Helper: BCD → IMEI =========
function bcdToImei(buf) {
    let s = "";
    for (let i = 0; i < buf.length; i++) {
        const hi = (buf[i] >> 4) & 0x0f;
        const lo = buf[i] & 0x0f;
        s += hi.toString() + lo.toString();
    }
    return s.replace(/^0+/, "") || "0";
}

// ========= CRC ==========
function computeCRC(buf) {
    const res = CRC16(buf);
    return typeof res === "string" ? parseInt(res, 16) : res;
}

// ========= Find header ==========
function findHeader(buf) {
    for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i] === 0x78 && buf[i + 1] === 0x78) return i;
    }
    return -1;
}

// ========= ACK Builder ==========
function buildAck(protocol, serial) {
    const ack = Buffer.alloc(10);
    ack[0] = 0x78;
    ack[1] = 0x78;
    ack[2] = 0x05;
    ack[3] = protocol;
    ack[4] = serial[0];
    ack[5] = serial[1];

    const crcPart = ack.slice(2, 6);
    const crcVal = computeCRC(crcPart);
    ack.writeUInt16BE(crcVal, 6);
    ack[8] = 0x0d;
    ack[9] = 0x0a;
    return ack;
}

// ===============================================================
//                        SERVER START
// ===============================================================

const server = net.createServer((socket) => {
    console.log("📡 Tracker connected:", socket.remoteAddress, socket.remotePort);

    let buffer = Buffer.alloc(0);
    let trackerIMEI = null;

    socket.on("data", async (data) => {
        buffer = Buffer.concat([buffer, data]);

        let headerIndex = findHeader(buffer);
        if (headerIndex > 0) buffer = buffer.slice(headerIndex);

        while (buffer.length >= 5) {
            if (buffer[0] !== 0x78 || buffer[1] !== 0x78) {
                buffer = buffer.slice(1);
                continue;
            }

            const len = buffer[2];
            const totalLen = len + 5;

            if (buffer.length < totalLen) break;

            const packet = buffer.slice(0, totalLen);
            buffer = buffer.slice(totalLen);

            if (packet[totalLen - 2] !== 0x0d || packet[totalLen - 1] !== 0x0a) continue;

            const protocol = packet[3];
            const serialOffset = totalLen - 6;
            const serial = packet.slice(serialOffset, serialOffset + 2);

            const crcGiven = packet.readUInt16BE(totalLen - 4);
            const crcCalc = computeCRC(packet.slice(2, totalLen - 4));

            if (crcGiven !== crcCalc) continue;

            switch (protocol) {

                // =================== LOGIN ===================
                case 0x01: {
                    trackerIMEI = bcdToImei(packet.slice(4, 12));

                    await redis.publish("login", JSON.stringify({
                        imei: trackerIMEI,
                        time: new Date().toISOString()
                    }));

                    socket.write(buildAck(0x01, serial));
                    break;
                }

                // =================== GPS =====================
                case 0x12: {
                    const latRaw = packet.readUInt32BE(11);
                    const lonRaw = packet.readUInt32BE(15);
                    const lat = latRaw / 30000.0 / 60.0;
                    const lon = lonRaw / 30000.0 / 60.0;
                    const speed = packet.readUInt8(19);

                    const cs = packet.readUInt16BE(20);
                    const isEast = (cs & 0x0200) !== 0;
                    const isNorth = (cs & 0x0400) !== 0;
                    const course = cs & 0x01FF;

                    const gpsData = {
                        imei: trackerIMEI,
                        lat,
                        lon,
                        speed,
                        course,
                        direction: `${isNorth ? "N" : "S"}${isEast ? "E" : "W"}`,
                        time: new Date().toISOString(),
                    };

                    await redis.publish("gps-update", JSON.stringify(gpsData));

                    socket.write(buildAck(0x12, serial));
                    break;
                }

                // =================== STATUS ==================
                case 0x10: {
                    const dataHex = packet.slice(4, serialOffset).toString("hex");

                    await redis.publish("status", JSON.stringify({
                        imei: trackerIMEI,
                        raw: dataHex,
                        time: new Date().toISOString(),
                    }));

                    socket.write(buildAck(0x10, serial));
                    break;
                }

                // =================== HEARTBEAT ===============
                case 0x13: {
                    await redis.publish("heartbeat", JSON.stringify({
                        imei: trackerIMEI,
                        time: new Date().toISOString(),
                    }));

                    socket.write(buildAck(0x13, serial));
                    break;
                }

                // =================== ALARM ===================
                case 0x16: {
                    const alarmCode = packet[4];

                    await redis.publish("alarm", JSON.stringify({
                        imei: trackerIMEI,
                        alarmCode,
                        time: new Date().toISOString(),
                    }));

                    socket.write(buildAck(0x16, serial));
                    break;
                }

                // =================== STRING INFO =============
                case 0x15: {
                    const text = packet.slice(4, serialOffset).toString("ascii");

                    await redis.publish("string-info", JSON.stringify({
                        imei: trackerIMEI,
                        text,
                        time: new Date().toISOString(),
                    }));

                    socket.write(buildAck(0x15, serial));
                    break;
                }

                // ================= COMMAND RESP ================
                case 0x80: {
                    const response = packet.slice(4, serialOffset).toString("hex");

                    await redis.publish("command-response", JSON.stringify({
                        imei: trackerIMEI,
                        response,
                        time: new Date().toISOString(),
                    }));

                    socket.write(buildAck(0x80, serial));
                    break;
                }
            }
        }
    });

    socket.on("close", () => {
        console.log("🔌 Tracker disconnected:", trackerIMEI);
    });

    socket.on("error", (err) => {
        console.log("❗ Socket error:", err.message);
    });
});

server.listen(PORT, () =>
    console.log(`🚀 GT06 TCP Server running on port ${PORT}`)
);
