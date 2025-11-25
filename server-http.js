import express from 'express';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/gps', (req, res) => {
    console.log('Received data:', req.body);

    const { imei, lat, lon, time, speed } = req.body;
    if (!imei) {
        return res.status(400).json({ error: 'Missing IMEI' });
    }

    // TODO: save to DB or log to file
    console.log(`Device ${imei}: ${lat},${lon} at ${time}, speed ${speed}`);

    res.json({ status: 'ok' });
});

const PORT = 5000;
app.listen(PORT, () => {
    console.log(`HTTP server running on port ${PORT}`);
});