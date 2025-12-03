import { startTracker } from "./simulator.js";

for (let i = 0; i < 10; i++) {
    const imei = "356860820045" + String(100 + i);
    startTracker({
        imei,
        lat: 22.5726 + Math.random() * 0.01,
        lon: 88.3639 + Math.random() * 0.01,
    });
}
