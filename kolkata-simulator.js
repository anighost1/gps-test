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
        buf[i / 2] = (parseInt(imei[i]) << 4) | parseInt(imei[i + 1]);
    }
    return buf;
}

// ====================== COURSE STATUS (GT06) ======================
// lower 9 bits  : heading 0–359
// bit 10 (0x0200) : East(1)/West(0)
// bit 11 (0x0400) : North(1)/South(0)

function buildCourseStatus(headingDeg) {
    let value = headingDeg & 0x01ff;

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
// lat/lon in degrees

function calculateHeading(lat1Deg, lon1Deg, lat2Deg, lon2Deg) {
    const toRad = (d) => (d * Math.PI) / 180;

    const lat1 = toRad(lat1Deg);
    const lat2 = toRad(lat2Deg);
    const dLon = toRad(lon2Deg - lon1Deg);

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x =
        Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

    let brng = Math.atan2(y, x);
    brng = (brng * 180) / Math.PI;
    brng = (brng + 360) % 360;

    return Math.round(brng);
}

// ====================== PACKET BUILDER ======================

function packet(protocol, infoContent) {
    const serialBuf = nextSerial();
    const length = infoContent.length + 1 + 2 + 2; // protocol + serial + CRC
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

function gpsPacket(lat, lon, speed = 30, heading = 0) {
    const d = new Date();

    const time = Buffer.from([
        d.getUTCFullYear() - 2000,
        d.getUTCMonth() + 1,
        d.getUTCDate(),
        d.getUTCHours(),
        d.getUTCMinutes(),
        d.getUTCSeconds(),
    ]);

    const gpsInfo = Buffer.from([0xf0]); // GPS + LBS

    const latRaw = Math.floor(lat * 60 * 30000);
    const lonRaw = Math.floor(lon * 60 * 30000);

    const latBuf = Buffer.alloc(4);
    latBuf.writeUInt32BE(latRaw);

    const lonBuf = Buffer.alloc(4);
    lonBuf.writeUInt32BE(lonRaw);

    const speedBuf = Buffer.from([Math.floor(speed)]);
    const courseStatus = buildCourseStatus(heading);

    // LBS / cell info (dummy)
    const lac = Buffer.from([0x00, 0x01]);
    const cell = Buffer.from([0x00, 0x01, 0x01]);
    const mcc = Buffer.from([0x02, 0xf5]); // pseudo 0x02F5
    const mnc = Buffer.from([0x00]);

    return packet(
        0x12,
        Buffer.concat([
            time,
            gpsInfo,
            latBuf,
            lonBuf,
            speedBuf,
            courseStatus,
            lac,
            cell,
            mcc,
            mnc,
        ])
    );
}

function heartbeatPacket() {
    return packet(0x13, Buffer.from([0x01]));
}

// ====================== CITY ROUTE ======================
// Example: Small route around Kolkata (you can change these)

const KOLKATA_ROUTE = [
    { lat: 22.5726, lon: 88.3639 }, // point A
    { lat: 22.5745, lon: 88.3700 },
    { lat: 22.5762, lon: 88.3790 },
    { lat: 22.5740, lon: 88.3870 },
    { lat: 22.5695, lon: 88.3905 },
    { lat: 22.5660, lon: 88.3820 },
    { lat: 22.5685, lon: 88.3740 },
    { lat: 22.5726, lon: 88.3639 }, // back near start
];

// ====================== ROUTE SIMULATOR ======================

export function startRouteTracker({
    imei,
    host = "127.0.0.1",
    port = 5000,
    route = KOLKATA_ROUTE,
    speedKmh = 40,        // average speed
    intervalMs = 5000,    // send GPS every 5s
    loop = true,
}) {
    if (!route || route.length < 2) {
        throw new Error("Route must have at least 2 points");
    }

    const sock = new net.Socket();

    let segIndex = 0;         // current segment index (between route[i] and route[i+1])
    let t = 0;                // interpolation factor between 0 and 1
    const metersPerSecond = (speedKmh * 1000) / 3600;
    const approxSegmentMeters = 150; // just approximate for interpolation speed
    const dtSeconds = intervalMs / 1000;
    const step = (metersPerSecond * dtSeconds) / approxSegmentMeters;

    sock.connect(port, host, () => {
        console.log("✓ Route tracker connected:", imei);

        // LOGIN first
        sock.write(loginPacket(imei));

        // HEARTBEAT loop
        setInterval(() => {
            sock.write(heartbeatPacket());
        }, 20000);

        // GPS route loop
        setInterval(() => {
            const p1 = route[segIndex];
            const p2 = route[segIndex + 1];

            // interpolate t from 0 -> 1 along segment
            t += step;
            if (t >= 1) {
                t = t - 1;
                segIndex++;
                if (segIndex >= route.length - 1) {
                    if (loop) {
                        segIndex = 0;
                    } else {
                        console.log("Route finished, closing tracker:", imei);
                        sock.end();
                        return;
                    }
                }
            }

            const curP1 = route[segIndex];
            const curP2 = route[segIndex + 1];

            const lat =
                curP1.lat + (curP2.lat - curP1.lat) * t;
            const lon =
                curP1.lon + (curP2.lon - curP1.lon) * t;

            const heading = calculateHeading(
                curP1.lat,
                curP1.lon,
                curP2.lat,
                curP2.lon
            );

            const speed = speedKmh; // constant for now

            console.log(
                `GPS → IMEI=${imei} lat=${lat.toFixed(
                    6
                )}, lon=${lon.toFixed(6)}, heading=${heading}, speed=${speed}`
            );

            sock.write(gpsPacket(lat, lon, speed, heading));
        }, intervalMs);
    });

    sock.on("data", (d) => {
        console.log("ACK:", d.toString("hex"));
    });

    sock.on("close", () => {
        console.log("Tracker closed:", imei);
    });

    sock.on("error", (err) => {
        console.error("Tracker socket error:", err.message);
    });
}
