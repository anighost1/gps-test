import net from 'net';
import CRC16 from 'node-crc-itu'; // install via: npm install node-crc-itu

const HOST = '127.0.0.1';
const PORT = 5001;
const IMEI = '356860820045174';

function encodeIMEIToBCD(imei) {
    const padded = imei.padEnd(16, 'F'); // GT06 pads to 8 BCD bytes
    const buffer = Buffer.alloc(8);
    for (let i = 0; i < 8; i++) {
        buffer[i] = parseInt(padded.substr(i * 2, 2), 16);
    }
    return buffer;
}

function buildLoginPacket() {
    const start = Buffer.from([0x78, 0x78]);
    const protocol = Buffer.from([0x01]);
    const imei = encodeIMEIToBCD(IMEI);
    const serial = Buffer.from([0x00, 0x01]);
    const length = Buffer.from([protocol.length + imei.length + serial.length]);

    const content = Buffer.concat([protocol, imei, serial]);
    const crcValue = CRC16(content);
    const crc = Buffer.alloc(2);
    crc.writeUInt16BE(parseInt(crcValue, 16));
    const end = Buffer.from([0x0D, 0x0A]);

    const packet = Buffer.concat([start, length, content, crc, end]);
    console.log('Sending Login Packet:', packet.toString('hex'));
    return packet;
}

// TCP client
const client = new net.Socket();
client.connect(PORT, HOST, () => {
    console.log('✅ Connected to server');
    const packet = buildLoginPacket();
    client.write(packet);
});

client.on('data', (data) => {
    console.log('📥 Server replied:', data.toString('hex'));
});

client.on('close', () => {
    console.log('🔌 Disconnected');
});

client.on('error', (err) => {
    console.error('❗ Error:', err.message);
});
