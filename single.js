import { startTracker } from "./simulator.js";


const imei = "356860820045174";
startTracker({
    imei,
    lat: 22.5726 + Math.random() * 0.01,
    lon: 88.3639 + Math.random() * 0.01,
});
