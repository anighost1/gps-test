import net from "net";
import { pool } from "../db/pg.js";

// import your existing packet functions
import {
    loginPacket,
    gpsPacket,
    heartbeatPacket
} from "../simulator.js";

export async function startTrackerReplay({
    imei,
    host = "127.0.0.1",
    port = 5000,
}) {
    const res = await pool.query(
        `
        SELECT lat, lon, speed, course, created_at
        FROM public.gps_position
        WHERE imei = $1
        ORDER BY created_at ASC
        `,
        [imei]
    );

    const gpsData = res.rows;

    if (!gpsData.length) {
        console.log("❌ No GPS data found for IMEI:", imei);
        return;
    }

    const sock = new net.Socket();

    sock.connect(port, host, () => {
        console.log("✓ Replay tracker connected:", imei);

        sock.write(loginPacket(imei));

        let index = 0;

        function sendNext() {
            if (index >= gpsData.length - 1) {
                console.log("🔁 Looping replay...");
                index = 0;
            }

            const current = gpsData[index];
            const next = gpsData[index + 1];

            const gpsLat = parseFloat(current.lat);
            const gpsLon = parseFloat(current.lon);
            const speed = current.speed || 10;
            const heading = current.course || 0;

            sock.write(
                gpsPacket(gpsLat, gpsLon, speed, heading)
            );

            index++;

            let delay = 5000;

            if (next) {
                delay =
                    new Date(next.created_at) -
                    new Date(current.created_at);
            }

            delay = Math.max(1000, Math.min(delay, 10000));

            setTimeout(sendNext, delay);
        }

        sendNext();

        setInterval(() => {
            sock.write(heartbeatPacket());
        }, 60000);
    });

    sock.on("data", d =>
        console.log("ACK:", d.toString("hex"))
    );

    sock.on("close", () =>
        console.log("Tracker closed:", imei)
    );
}