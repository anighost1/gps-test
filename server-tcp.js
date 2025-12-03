// gt06-server.js
import net from "net";
import CRC16 from "node-crc-itu";

// CONFIG
const PORT = 5001;

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

    socket.on("data", (data) => {
        buffer = Buffer.concat([buffer, data]);

        // Align packet start
        let headerIndex = findHeader(buffer);
        if (headerIndex > 0) buffer = buffer.slice(headerIndex);

        while (buffer.length >= 5) {
            if (buffer[0] !== 0x78 || buffer[1] !== 0x78) {
                buffer = buffer.slice(1);
                continue;
            }

            const len = buffer[2];
            const totalLen = len + 5; // 2 start + 1 len + len + 2 end

            if (buffer.length < totalLen) break;

            const packet = buffer.slice(0, totalLen);
            buffer = buffer.slice(totalLen);

            // Validate tail
            if (packet[totalLen - 2] !== 0x0d || packet[totalLen - 1] !== 0x0a) {
                console.warn("⚠️ 0x0D0A missing – ignoring.");
                continue;
            }

            const protocol = packet[3];

            // Serial number (before CRC and tail)
            const serialOffset = totalLen - 6;
            const serial = packet.slice(serialOffset, serialOffset + 2);

            // CRC check
            const crcGiven = packet.readUInt16BE(totalLen - 4);
            const crcCalc = computeCRC(packet.slice(2, totalLen - 4));

            if (crcGiven !== crcCalc) {
                console.warn(`⚠️ CRC mismatch. Got ${crcGiven}, expected ${crcCalc}`);
                continue;
            }

            // =====================================================
            //              PACKET TYPE HANDLERS
            // =====================================================

            switch (protocol) {
                // -------------------------------------------------
                // LOGIN (0x01)
                // -------------------------------------------------
                case 0x01: {
                    const imeiBuf = packet.slice(4, 12);
                    trackerIMEI = bcdToImei(imeiBuf);
                    console.log("🔐 Login:", trackerIMEI);
                    socket.write(buildAck(0x01, serial));
                    break;
                }

                // -------------------------------------------------
                // GPS (0x12)
                // -------------------------------------------------
                case 0x12: {
                    try {
                        // -----------------------------
                        // Decode latitude / longitude
                        // -----------------------------
                        const latRaw = packet.readUInt32BE(11);
                        const lonRaw = packet.readUInt32BE(15);

                        const lat = latRaw / 30000.0 / 60.0;
                        const lon = lonRaw / 30000.0 / 60.0;

                        // -----------------------------
                        // Speed (1 byte)
                        // -----------------------------
                        const speed = packet.readUInt8(19);

                        // -----------------------------
                        // Course + status (2 bytes)
                        // Bits:
                        // bit10: West/East
                        // bit11: South/North
                        // bit12-15: course degrees
                        // -----------------------------
                        const courseStatus = packet.readUInt16BE(20);

                        const isEast = (courseStatus & 0x0200) !== 0;
                        const isNorth = (courseStatus & 0x0400) !== 0;

                        const courseDegrees = courseStatus & 0x01FF; // lower 9 bits

                        const direction = `${isNorth ? "N" : "S"}${isEast ? "E" : "W"}`;

                        // -----------------------------
                        // Output parsed GPS
                        // -----------------------------
                        console.log("📍 GPS:", {
                            imei: trackerIMEI,
                            lat,
                            lon,
                            speed,
                            course: courseDegrees,
                            direction,
                            time: new Date().toISOString(),
                        });

                        socket.write(buildAck(0x12, serial));
                    } catch (e) {
                        console.error("GPS parse error", e);
                    }
                    break;
                }

                // -------------------------------------------------
                // HEARTBEAT (0x13)
                // -------------------------------------------------
                case 0x13: {
                    console.log("💓 Heartbeat:", trackerIMEI);
                    socket.write(buildAck(0x13, serial));
                    break;
                }

                // -------------------------------------------------
                // STATUS (0x10)
                // -------------------------------------------------
                case 0x10: {
                    const info = packet.slice(4, serialOffset);
                    console.log("🔧 Status packet:", trackerIMEI, "Data:", info.toString("hex"));
                    socket.write(buildAck(0x10, serial));
                    break;
                }

                // -------------------------------------------------
                // STRING INFORMATION (0x15)
                // -------------------------------------------------
                case 0x15: {
                    const str = packet.slice(4, serialOffset).toString("ascii");
                    console.log("💬 String Info:", str);
                    socket.write(buildAck(0x15, serial));
                    break;
                }

                // -------------------------------------------------
                // ALARM (0x16)
                // -------------------------------------------------
                case 0x16: {
                    const alarm = packet[4].toString(16).padStart(2, "0");
                    console.log("🚨 Alarm:", trackerIMEI, "Code:", alarm);
                    socket.write(buildAck(0x16, serial));
                    break;
                }

                // -------------------------------------------------
                // COMMAND RESPONSE (0x80)
                // -------------------------------------------------
                case 0x80: {
                    const resp = packet.slice(4, serialOffset).toString("hex");
                    console.log("📥 Command Response:", resp);
                    socket.write(buildAck(0x80, serial));
                    break;
                }

                // -------------------------------------------------
                // UNKNOWN PACKETS
                // -------------------------------------------------
                default:
                    console.log(`📦 Unknown Protocol 0x${protocol.toString(16)} IMEI:`, trackerIMEI);
                    console.log("Raw:", packet.toString("hex"));
                    socket.write(buildAck(protocol, serial));
            }
        }
    });

    socket.on("close", () => console.log("🔌 Tracker disconnected", trackerIMEI));
    socket.on("error", err => console.error("❗ Socket error:", err.message));
});

server.listen(PORT, () => console.log(`🚀 GT06 Server running on port ${PORT}`));
