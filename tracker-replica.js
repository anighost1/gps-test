import net from "net";
import CRC16 from "node-crc-itu";

const HOST = "127.0.0.1";
const PORT = 5001;
const IMEI = "356860820045174";

let serial = 1;

// pad IMEI to 16 digits and encode BCD
function encodeIMEI(imei) {
    if (imei.length === 15) imei = "0" + imei;
    const buf = Buffer.alloc(8);
    for (let i = 0; i < 16; i += 2) {
        const hi = parseInt(imei[i], 10);
        const lo = parseInt(imei[i + 1], 10);
        buf[i / 2] = (hi << 4) | lo;
    }
    return buf;
}

// helper: CRC16 from Length to Serial
function crc(buffer) {
    const val = parseInt(CRC16(buffer), 16);
    const out = Buffer.alloc(2);
    out.writeUInt16BE(val);
    return out;
}

// build generic packet
function buildPacket(protocol, infoContent) {
    const serialBuf = Buffer.alloc(2);
    serialBuf.writeUInt16BE(serial++);

    const length = Buffer.from([infoContent.length + 1 + 2 + 2]);
    // 1 = Protocol Number
    // 2 = Serial Number
    // 2 = CRC

    const header = Buffer.from([0x78, 0x78]);

    const body = Buffer.concat([length, Buffer.from([protocol]), infoContent, serialBuf]);
    const crcVal = crc(body);

    const packet = Buffer.concat([header, body, crcVal, Buffer.from([0x0D, 0x0A])]);

    console.log("SEND:", packet.toString("hex").toUpperCase());
    return packet;
}

// ==== LOGIN PACKET (Protocol 0x01) ====

function buildLogin() {
    const imei = encodeIMEI(IMEI);
    const infoContent = imei; // login: only IMEI, no extra fields
    return buildPacket(0x01, infoContent);
}

// ==== GPS PACKET (Protocol 0x12) =====

function buildGPS(lat, lon, speed = 20) {
    const now = new Date();

    const year = now.getUTCFullYear() - 2000;
    const month = now.getUTCMonth() + 1;
    const day = now.getUTCDate();
    const hour = now.getUTCHours();
    const min = now.getUTCMinutes();
    const sec = now.getUTCSeconds();

    const time = Buffer.from([year, month, day, hour, min, sec]);

    // convert latitude/longitude to GT06 format:
    // raw = degrees * 60 * 30000
    const latRaw = Math.floor(lat * 60 * 30000);
    const lonRaw = Math.floor(lon * 60 * 30000);

    const latBuf = Buffer.alloc(4);
    latBuf.writeUInt32BE(latRaw);

    const lonBuf = Buffer.alloc(4);
    lonBuf.writeUInt32BE(lonRaw);

    const gpsInfo = Buffer.from([0xF0]);
    // bitmask:
    // GPS fixed + real-time positioning

    const speedBuf = Buffer.from([speed]);

    const courseStatus = Buffer.alloc(2);
    courseStatus.writeUInt16BE(0x0000); // no special flags

    const LAC = Buffer.from([0x00, 0x00]);
    const cellID = Buffer.from([0x00, 0x00, 0x01]);
    const MCC = Buffer.from([0x02, 0xF5]); // 0x02F5 = 757? Change if needed
    const MNC = Buffer.from([0x00]);

    const info = Buffer.concat([
        time,
        gpsInfo,
        latBuf,
        lonBuf,
        speedBuf,
        courseStatus,
        LAC,
        cellID,
        MCC,
        MNC
    ]);

    return buildPacket(0x12, info);
}

// ==== HEARTBEAT (0x13) ====
function buildHeartbeat() {
    const info = Buffer.from([0x01]); // battery/acc/signal flags
    return buildPacket(0x13, info);
}

// ====== CLIENT SIMULATOR ======

const client = new net.Socket();

client.connect(PORT, HOST, () => {
    console.log("Connected");

    // send login
    client.write(buildLogin());

    // send GPS every 5 seconds
    setInterval(() => {
        const packet = buildGPS(22.5726, 88.3639); // Kolkata coords
        client.write(packet);
    }, 5000);

    // send heartbeat every 20 sec
    setInterval(() => {
        client.write(buildHeartbeat());
    }, 20000);
});

client.on("data", data => {
    console.log("ACK:", data.toString("hex").toUpperCase());
});
