import { startTracker } from "./simulator.js";


const imei = "356860820045174";

//Kolkata
// startTracker({
//     imei,
//     lat: 22.5726 + Math.random() * 0.01,
//     lon: 88.3639 + Math.random() * 0.01,
//     host : "192.168.0.159",
// });

//Ranchi
startTracker({
    imei: imei,
    lat: 23.3441,  
    lon: 85.3096,  
});