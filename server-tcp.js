// gt06-server.js
import net from "net";
import CRC16 from "node-crc-itu"; // keep using this (returns hex string in many versions)

// CONFIG
const PORT = 5001;
const allowedIMEIs = ["356860820045174"]; // optional allowlist (comment out or change)

// Helper: find start header (0x78 0x78) in buffer
function findHeader(buf) {
    for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i] === 0x78 && buf[i + 1] === 0x78) return i;
    }
    return -1;
}

// Helper: BCD -> IMEI decode
function bcdToImei(buf) {
    // Each nibble is a digit: high nibble then low nibble
    let s = "";
    for (let i = 0; i < buf.length; i++) {
        const hi = (buf[i] >> 4) & 0x0f;
        const lo = buf[i] & 0x0f;
        s += hi.toString();
        s += lo.toString();
    }
    // GT06 IMEI often padded with leading zeros — trim any leading zeros that are not meaningful
    // But make sure we return at least something (don't remove all zeros)
    return s.replace(/^0+/, "") || "0";
}

// Helper: compute CRC16 numeric (wrap node-crc-itu and fallback)
function computeCrc16Numeric(buffer) {
    // node-crc-itu usually accepts Buffer and returns hex string like '1A2B'
    try {
        const res = CRC16(buffer);
        if (typeof res === "string") return parseInt(res, 16);
        if (typeof res === "number") return res;
    } catch (e) {
        // fallback JS implementation (CRC-ITU / CRC-16-IBM variant)
    }

    // Fallback: CRC-16/CCITT-FALSE (0x1021) implementation
    let crc = 0x0000;
    for (let i = 0; i < buffer.length; i++) {
        crc ^= (buffer[i] << 8);
        for (let j = 0; j < 8; j++) {
            if ((crc & 0x8000) !== 0) crc = ((crc << 1) ^ 0x1021) & 0xffff;
            else crc = (crc << 1) & 0xffff;
        }
    }
    return crc & 0xffff;
}

// Build an ACK packet for a given protocol and serial (2 bytes)
function buildAck(protocol, serialBuffer) {
    // packet structure: 0x78 0x78 | len | protocol | serial(2) | crc(2) | 0x0d 0x0a
    // len for ack is 0x05 (protocol + serial(2) + crc(2)? typical GT06 ack uses len=0x05)
    const ack = Buffer.alloc(10);
    ack[0] = 0x78;
    ack[1] = 0x78;
    ack[2] = 0x05; // length
    ack[3] = protocol;
    ack[4] = serialBuffer[0];
    ack[5] = serialBuffer[1];

    // compute CRC over bytes from len (index 2) up to serial (index 5) inclusive
    const crcPart = ack.slice(2, 6);
    const crcVal = computeCrc16Numeric(crcPart);
    ack.writeUInt16BE(crcVal & 0xffff, 6);

    ack[8] = 0x0d;
    ack[9] = 0x0a;

    return ack;
}

const server = net.createServer((socket) => {
    console.log("📡 Tracker connected:", socket.remoteAddress, socket.remotePort);
    let buffer = Buffer.alloc(0);
    let trackerIMEI = null;

    socket.on("data", (data) => {
        buffer = Buffer.concat([buffer, data]);

        // If header not at start, search and discard preceding bytes
        let headerIndex = findHeader(buffer);
        if (headerIndex > 0) {
            buffer = buffer.slice(headerIndex);
        }

        // Process as many full packets as present
        while (buffer.length >= 5) {
            // need at least header + len + crc + tail to decide
            if (buffer[0] !== 0x78 || buffer[1] !== 0x78) {
                // drop first byte and continue searching
                buffer = buffer.slice(1);
                headerIndex = findHeader(buffer);
                if (headerIndex > 0) buffer = buffer.slice(headerIndex);
                continue;
            }

            const len = buffer[2]; // length byte
            // totalLen = 2 start + 1 len + len (body including protocol+...+serial+crc?) + 2 tail (0d0a)
            const totalLen = len + 5; // 2 + 1 + len + 2
            if (buffer.length < totalLen) break; // wait for more data

            const packet = buffer.slice(0, totalLen);
            buffer = buffer.slice(totalLen); // advance

            // basic validation of trailing bytes
            const tail1 = packet[packet.length - 2];
            const tail2 = packet[packet.length - 1];
            if (tail1 !== 0x0d || tail2 !== 0x0a) {
                console.warn("⚠️ Packet missing 0D0A tail, ignoring chunk");
                continue;
            }

            // serial is two bytes located before CRC (2 bytes) and tail (2 bytes)
            // CRC is at offsets: totalLen - 4 and totalLen - 3 (big-endian)
            const serialOffset = totalLen - 6;
            const serial = packet.slice(serialOffset, serialOffset + 2); // 2 bytes serial
            const crcReceived = packet.readUInt16BE(totalLen - 4);

            // compute CRC over bytes from length (index 2) up to serial (inclusive)
            const crcCalcPart = packet.slice(2, totalLen - 4);
            const crcCalculated = computeCrc16Numeric(crcCalcPart);

            if (crcReceived !== crcCalculated) {
                console.warn(
                    `⚠️ CRC mismatch (received 0x${crcReceived.toString(16)}, calculated 0x${crcCalculated.toString(
                        16
                    )}). Ignoring packet.`
                );
                continue;
            }

            const protocol = packet[3];

            // --- LOGIN PACKET (protocol 0x01) ---
            if (protocol === 0x01) {
                // IMEI BCD typically stored starting at byte index 4, length 8 bytes
                // Some devices use index 4..11 (8 bytes)
                const imeiBuf = packet.slice(4, 12);
                const imei = bcdToImei(imeiBuf);
                trackerIMEI = imei;
                console.log("✅ Login received. IMEI:", trackerIMEI);

                // Optionally enforce allowlist
                if (Array.isArray(allowedIMEIs) && allowedIMEIs.length && !allowedIMEIs.includes(trackerIMEI)) {
                    console.log("❌ IMEI not allowed, closing connection:", trackerIMEI);
                    // send ack that may indicate rejection? usually we just close.
                    socket.destroy();
                    return;
                }

                // send login ack (protocol 0x01)
                const ack = buildAck(0x01, serial);
                socket.write(ack);
                continue;
            }

            // --- GPS LOCATION (protocol 0x12) ---
            if (protocol === 0x12) {
                // GT06: info content starts at index 4. Typically:
                // 4: date/time and GPS info; lat/lon are 4 bytes each at specific offsets
                // many devices: latitude at offset 11..14, longitude at 15..18 (relative to start)
                // We'll check packet length and read safely
                try {
                    // indexes relative to packet start
                    const latIndex = 11;
                    const lonIndex = 15;
                    if (packet.length >= lonIndex + 4 + 4) {
                        const latRaw = packet.readUInt32BE(latIndex);
                        const lonRaw = packet.readUInt32BE(lonIndex);
                        const latitude = latRaw / 30000 / 60;
                        const longitude = lonRaw / 30000 / 60;

                        const timestamp = new Date().toISOString();

                        const location = {
                            imei: trackerIMEI || "UNKNOWN",
                            latitude,
                            longitude,
                            protocol: "0x12",
                            receivedAt: timestamp,
                        };

                        console.log("📍 GPS Data:", location);
                    } else {
                        console.warn("⚠️ GPS packet too short for lat/lon extraction");
                    }
                } catch (err) {
                    console.error("❗ Error parsing GPS data:", err);
                }

                // send GPS ack (protocol 0x12)
                const ack = buildAck(0x12, serial);
                socket.write(ack);
                continue;
            }

            // --- HEARTBEAT (protocol 0x13) ---
            if (protocol === 0x13) {
                console.log("💓 Heartbeat received from", trackerIMEI || "UNKNOWN");
                const ack = buildAck(0x13, serial);
                socket.write(ack);
                continue;
            }

            // --- STATUS (protocol 0x10) ---
            if (protocol === 0x10) {
                console.log("🔧 Status packet received (protocol 0x10). IMEI:", trackerIMEI || "UNKNOWN");
                const ack = buildAck(0x10, serial);
                socket.write(ack);
                continue;
            }

            // --- Other protocols: log and ack generically ---
            console.log(`ℹ️ Received protocol 0x${protocol.toString(16)} (IMEI: ${trackerIMEI || "UNKNOWN"})`);
            const ack = buildAck(protocol, serial);
            socket.write(ack);
        } // end while
    }); // end data

    socket.on("error", (err) => {
        console.error("❗ Socket error:", err?.message || err);
    });

    socket.on("close", () => {
        console.log("🔌 Tracker disconnected:", trackerIMEI || socket.remoteAddress);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 GT06-like TCP Server running on port ${PORT}`);
});
