import net from "net";
import CRC16 from "node-crc-itu";

// GLOBAL SERIAL COUNTER
let globalSerial = 1;

// ======================= UTILITIES =========================

function crc(buffer) {
    const val = parseInt(CRC16(buffer), 16);
    const buf = Buffer.alloc(2);
    buf.writeUInt16BE(val);
    return buf;
}

function bcdImei(imei) {
    if (imei.length === 15) imei = "0" + imei;
    const buf = Buffer.alloc(8);
    for (let i = 0; i < 16; i += 2) {
        buf[i / 2] = (parseInt(imei[i]) << 4) | parseInt(imei[i + 1]);
    }
    return buf;
}

function nextSerial() {
    const buf = Buffer.alloc(2);
    buf.writeUInt16BE(globalSerial++ & 0xffff);
    return buf;
}

function packet(protocol, infoContent) {
    const serialBuf = nextSerial();
    const length = Buffer.from([infoContent.length + 1 + 2 + 2]);

    const body = Buffer.concat([length, Buffer.from([protocol]), infoContent, serialBuf]);
    const checksum = crc(body);

    return Buffer.concat([
        Buffer.from([0x78, 0x78]),
        body,
        checksum,
        Buffer.from([0x0d, 0x0a])
    ]);
}

// ====================== PACKET BUILDERS =====================

function loginPacket(imei) {
    return packet(0x01, bcdImei(imei));
}

function gpsPacket(lat, lon, speed = 10) {
    const d = new Date();
    const time = Buffer.from([
        d.getUTCFullYear() - 2000,
        d.getUTCMonth() + 1,
        d.getUTCDate(),
        d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()
    ]);

    const gpsInfo = Buffer.from([0xF0]); // GPS + LBS

    const latRaw = Math.floor(lat * 60 * 30000);
    const lonRaw = Math.floor(lon * 60 * 30000);

    const latBuf = Buffer.alloc(4); latBuf.writeUInt32BE(latRaw);
    const lonBuf = Buffer.alloc(4); lonBuf.writeUInt32BE(lonRaw);

    const speedBuf = Buffer.from([Math.floor(speed)]);

    const courseStatus = Buffer.from([0x00, 0x00]);

    const LAC = Buffer.from([0x00, 0x01]);
    const cell = Buffer.from([0x00, 0x01, 0x01]);
    const mcc = Buffer.from([0x02, 0xF5]); // India (404) pseudo-coded
    const mnc = Buffer.from([0x00]);

    return packet(
        0x12,
        Buffer.concat([
            time, gpsInfo, latBuf, lonBuf, speedBuf,
            courseStatus, LAC, cell, mcc, mnc
        ])
    );
}

function heartbeatPacket() {
    return packet(0x13, Buffer.from([0x01]));
}

function statusPacket(batteryLevel) {
    return packet(0x10, Buffer.from([batteryLevel]));
}

// Alarm example: geofence, low battery, speeding
function alarmPacket(code) {
    return packet(0x16, Buffer.from([code]));
}

// =================== SIMULATION ENGINE ======================

function insideGeofence(lat, lon, fence) {
    const dx = lat - fence.lat;
    const dy = lon - fence.lon;
    return dx * dx + dy * dy <= fence.radius * fence.radius;
}

export function startTracker({
    imei,
    lat,
    lon,
    host = "127.0.0.1",
    port = 5001,
}) {
    const sock = new net.Socket();

    // Simulation State
    let battery = 80;
    let speed = 0;
    let inFence = false;

    const geofence = {
        lat,
        lon,
        radius: 0.002 // ~200m
    };

    sock.connect(port, host, () => {
        console.log("Tracker connected:", imei);

        sock.write(loginPacket(imei));

        // GPS loop
        setInterval(() => {
            // Random movement
            lat += (Math.random() - 0.5) * 0.0005;
            lon += (Math.random() - 0.5) * 0.0005;

            // Speed simulation
            if (Math.random() > 0.5) speed += 5;
            else speed -= 3;
            if (speed < 0) speed = 0;
            if (speed > 120) speed = 120;

            sock.write(gpsPacket(lat, lon, speed));

            // Low battery alarm
            battery -= 0.2;
            if (battery < 20) {
                sock.write(alarmPacket(0x02)); // low battery alarm
            }

            // Status packet with battery %
            sock.write(statusPacket(Math.round(battery)));

            // Geofence detection
            const nowInside = insideGeofence(lat, lon, geofence);
            if (nowInside && !inFence) {
                inFence = true;
                sock.write(alarmPacket(0x11)); // geofence enter
            }
            if (!nowInside && inFence) {
                inFence = false;
                sock.write(alarmPacket(0x12)); // geofence exit
            }

        }, 5000);

        // Heartbeat
        setInterval(() => {
            sock.write(heartbeatPacket());
        }, 20000);
    });

    sock.on("data", d => {
        console.log("ACK:", d.toString("hex"));
    });

    sock.on("close", () => console.log("Tracker closed:", imei));
}
