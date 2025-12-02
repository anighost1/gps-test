import net from 'net';
import CRC16 from 'node-crc-itu';

const client = new net.Socket();
const PORT = 5001;
const HOST = '127.0.0.1';
const IMEI = '356860820045174'; // 15-digit

function encodeIMEI(imei) {
    const padded = imei.length % 2 === 0 ? imei : imei + 'F';
    const buf = Buffer.alloc(padded.length / 2);
    for (let i = 0; i < padded.length; i += 2) {
        buf[i / 2] = parseInt(padded[i] + padded[i + 1], 16);
    }
    return buf;
}

function buildLoginPacket() {
    const protocol = Buffer.from([0x01]);
    const imeiBuf = encodeIMEI(IMEI);
    const serial = Buffer.from([0x00, 0x01]); // optional, any serial

    const body = Buffer.concat([protocol, imeiBuf, serial]);
    const length = Buffer.from([body.length]);
    const crc = Buffer.alloc(2);
    const crcValue = parseInt(CRC16(body), 16);
    crc.writeUInt16BE(crcValue);

    const final = Buffer.concat([
        Buffer.from([0x78, 0x78]),
        length,
        body,
        crc,
        Buffer.from([0x0D, 0x0A]),
    ]);

    console.log('Final packet (HEX):', final.toString('hex'));
    return final;
}

client.connect(PORT, HOST, () => {
    console.log('🔗 Connected to server');
    const loginPacket = buildLoginPacket();
    client.write(loginPacket);
});

client.on('data', (data) => {
    console.log('📥 ACK from server:', data.toString('hex'));
});

client.on('close', () => {
    console.log('🔌 Connection closed');
});

client.on('error', (err) => {
    console.error('❗ Error:', err.message);
});
