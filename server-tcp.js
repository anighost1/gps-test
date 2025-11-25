// Basic TCP Server to Receive PS10B Tracker Data and Relay to HTTP Backend


import net from 'net'
import axios from 'axios'
import CRC16 from 'node-crc-itu'


const HTTP_ENDPOINT = 'https://08fec59176ec.ngrok-free.app/api/gps';


const server = net.createServer((socket) => {
    console.log('Tracker connected:', socket.remoteAddress);
    let buffer = Buffer.alloc(0);


    socket.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);

        const message = data.toString().trim()
        console.log('data', message);


        while (buffer.length >= 5 && buffer[0] === 0x78 && buffer[1] === 0x78) {
            const len = buffer[2];
            const totalLen = len + 5; // 2 start + 1 length + len + 2 stop
            if (buffer.length < totalLen) break;


            const packet = buffer.slice(0, totalLen);
            buffer = buffer.slice(totalLen);


            const protocol = packet[3];
            const serial = packet.readUInt16BE(totalLen - 4);
            const crc = packet.readUInt16BE(totalLen - 4);
            const calcCrc = parseInt(CRC16(packet.slice(2, totalLen - 4)), 16);


            if (crc !== calcCrc) {
                console.error('CRC mismatch, ignoring packet');
                continue;
            }


            if (protocol === 0x01) {
                const imei = packet.slice(4, 12).toString('hex');
                console.log(`Login from IMEI: ${imei}`);


                const ack = Buffer.from([
                    0x78, 0x78, 0x05, 0x01,
                    packet[12], packet[13],
                    0x00, 0x00, 0x0D, 0x0A
                ]);
                const ackCrc = CRC16(ack.slice(2, 6));
                ack.writeUInt16BE(parseInt(ackCrc, 16), 6);
                socket.write(ack);
            }


            if (protocol === 0x12) {
                const imei = 'UNKNOWN'; // or track IMEI from previous login
                const date = new Date(); // Can be parsed from packet[4-10] if needed
                const lat = packet.readUInt32BE(11) / 30000 / 60;
                const lon = packet.readUInt32BE(15) / 30000 / 60;


                const payload = {
                    imei,
                    latitude: lat,
                    longitude: lon,
                    timestamp: date.toISOString()
                };


                console.log('Forwarding location to backend:', payload);
                axios.post(HTTP_ENDPOINT, payload)
                    .then(res => console.log('Forwarded successfully'))
                    .catch(err => console.error('Error forwarding:', err.message));


                const ack = Buffer.from([
                    0x78, 0x78, 0x05, 0x12,
                    packet[totalLen - 6], packet[totalLen - 5],
                    0x00, 0x00, 0x0D, 0x0A
                ]);
                const ackCrc = CRC16(ack.slice(2, 6));
                ack.writeUInt16BE(parseInt(ackCrc, 16), 6);
                socket.write(ack);
            }
        }
    });
});


server.listen(5001, '127.0.0.1', () => {
    console.log('Server listening on port 5001');
});