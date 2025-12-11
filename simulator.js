import net from "net";
import CRC16 from "node-crc-itu";

// ====================== GLOBAL SERIAL ======================

let globalSerial = 1;

function nextSerial() {
    const buf = Buffer.alloc(2);
    buf.writeUInt16BE(globalSerial++ & 0xffff);
    return buf;
}

// ====================== CRC ======================

function crc(buffer) {
    const val = parseInt(CRC16(buffer), 16);
    const buf = Buffer.alloc(2);
    buf.writeUInt16BE(val);
    return buf;
}

// ====================== IMEI → BCD ======================

function bcdImei(imei) {
    if (imei.length === 15) imei = "0" + imei;

    const buf = Buffer.alloc(8);

    for (let i = 0; i < 16; i += 2) {
        buf[i / 2] =
            (parseInt(imei[i]) << 4) | parseInt(imei[i + 1]);
    }

    return buf;
}

// ====================== COURSE STATUS BUILDER ======================
// GT06 heading bit layout:
// - lower 9 bits → heading (0–359)
// - bit10 → East(1)/West(0)
// - bit11 → North(1)/South(0)

function buildCourseStatus(headingDeg) {
    let value = headingDeg & 0x01FF;

    if (headingDeg >= 90 && headingDeg < 270) {
        value |= 0x0200; // East
    }

    if (headingDeg < 180) {
        value |= 0x0400; // North
    }

    const buf = Buffer.alloc(2);
    buf.writeUInt16BE(value);
    return buf;
}

// ====================== HEADING CALCULATION ======================

function calculateHeading(lat1, lon1, lat2, lon2) {
    const dLon = lon2 - lon1;

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x =
        Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

    let bearing = Math.atan2(y, x);
    bearing = bearing * (180 / Math.PI);
    bearing = (bearing + 360) % 360;

    return Math.round(bearing);
}

// ====================== PACKET BUILDER ======================

function packet(protocol, infoContent) {
    const serialBuf = nextSerial();

    const length = infoContent.length + 1 + 2 + 2; // protocol + serial + crc
    const lengthBuf = Buffer.from([length]);

    const body = Buffer.concat([
        lengthBuf,
        Buffer.from([protocol]),
        infoContent,
        serialBuf,
    ]);

    const checksum = crc(body);

    return Buffer.concat([
        Buffer.from([0x78, 0x78]),
        body,
        checksum,
        Buffer.from([0x0d, 0x0a]),
    ]);
}

// ====================== PACKET TYPES ======================

function loginPacket(imei) {
    return packet(0x01, bcdImei(imei));
}

function gpsPacket(lat, lon, speed = 10, heading = 0) {
    const d = new Date();

    const time = Buffer.from([
        d.getUTCFullYear() - 2000,
        d.getUTCMonth() + 1,
        d.getUTCDate(),
        d.getUTCFullYear(),
        d.getUTCMinutes(),
        d.getUTCSeconds(),
    ]);

    const gpsInfo = Buffer.from([0xF0]);

    const latRaw = Math.floor(lat * 60 * 30000);
    const lonRaw = Math.floor(lon * 60 * 30000);

    const latBuf = Buffer.alloc(4);
    latBuf.writeUInt32BE(latRaw);

    const lonBuf = Buffer.alloc(4);
    lonBuf.writeUInt32BE(lonRaw);

    const speedBuf = Buffer.from([Math.floor(speed)]);
    const courseStatus = buildCourseStatus(heading);

    return packet(
        0x12,
        Buffer.concat([
            time,
            gpsInfo,
            latBuf,
            lonBuf,
            speedBuf,
            courseStatus,
            Buffer.from([0, 1]),
            Buffer.from([0, 1, 1]),
            Buffer.from([0x02, 0xF5]),
            Buffer.from([0x00]),
        ])
    );
}

function heartbeatPacket() {
    return packet(0x13, Buffer.from([0x01]));
}

function statusPacket(battery) {
    return packet(0x10, Buffer.from([battery]));
}

function alarmPacket(code) {
    return packet(0x16, Buffer.from([code]));
}

// ====================== GEOFENCE HELPERS ======================

function insideGeofence(lat, lon, fence) {
    const dx = lat - fence.lat;
    const dy = lon - fence.lon;
    return dx * dx + dy * dy <= fence.radius * fence.radius;
}

// ====================== START SIMULATOR ======================

export function startTracker({
    imei,
    lat,
    lon,
    host = "127.0.0.1",
    port = 5000,
}) {
    const sock = new net.Socket();

    let prevLat = lat;
    let prevLon = lon;

    let speed = 0;
    let battery = 80;
    let inFence = false;

    const geofence = {
        lat,
        lon,
        radius: 0.002,
    };

    sock.connect(port, host, () => {
        console.log("✓ Tracker connected", imei);

        sock.write(loginPacket(imei));

        setInterval(() => {
            prevLat = lat;
            prevLon = lon;

            // Random movement
            lat += (Math.random() - 0.5) * 0.0005;
            lon += (Math.random() - 0.5) * 0.0005;

            // Calculate heading
            const heading = calculateHeading(prevLat, prevLon, lat, lon);

            // Speed simulation
            speed += (Math.random() - 0.5) * 10;
            if (speed < 0) speed = 0;
            if (speed > 120) speed = 120;

            console.log(
                `GPS → lat=${lat.toFixed(6)}, lon=${lon.toFixed(6)}, heading=${heading}, speed=${speed}`
            );

            sock.write(gpsPacket(lat, lon, speed, heading));

            // Battery drain
            battery -= 0.2;
            if (battery < 20) sock.write(alarmPacket(0x02));

            sock.write(statusPacket(Math.round(battery)));

            // Geofence
            const inside = insideGeofence(lat, lon, geofence);
            if (inside && !inFence) {
                inFence = true;
                sock.write(alarmPacket(0x11)); // enter
            }
            if (!inside && inFence) {
                inFence = false;
                sock.write(alarmPacket(0x12)); // exit
            }
        }, 3000);

        // Heartbeat every 20 sec
        setInterval(() => {
            sock.write(heartbeatPacket());
        }, 20000);
    });

    sock.on("data", (d) => console.log("ACK:", d.toString("hex")));
    sock.on("close", () => console.log("Tracker closed:", imei));
}
