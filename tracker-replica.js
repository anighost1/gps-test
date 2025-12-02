import net from 'net';
import CRC16 from 'node-crc-itu';

const client = new net.Socket();
const PORT = 5001;
const HOST = '127.0.0.1';
const IMEI = '356860820045174'; // 15-digit GT06 IMEI

// GT06 requires *16-digit* BCD → pad left
function encodeIMEI(imei) {
    if (imei.length === 15) imei = "0" + imei;
    if (imei.length !== 16) throw new Error("IMEI must be 16 digits");

    const buf = Buffer.alloc(8);
    for (let i = 0; i < 16; i += 2) {
        const hi = parseInt(imei[i], 10);
        const lo = parseInt(imei[i + 1], 10);
        buf[i / 2] = (hi << 4) | lo;
    }
    return buf;
}

function buildLoginPacket() {
    const protocol = Buffer.from([0x01]);
    const imeiBuf = encodeIMEI(IMEI);
    const serial = Buffer.from([0x00, 0x01]);

    // BODY = protocol + IMEI + serial
    const body = Buffer.concat([protocol, imeiBuf, serial]);

    // Length = BODY length (GT06 rule)
    const length = Buffer.from([body.length]); // should equal 0x0B

    // CRC computed over LENGTH + BODY
    const crcInput = Buffer.concat([length, body]);
    const crcVal = parseInt(CRC16(crcInput), 16);

    const crc = Buffer.alloc(2);
    crc.writeUInt16BE(crcVal);

    const packet = Buffer.concat([
        Buffer.from([0x78, 0x78]),
        length,
        body,
        crc,
        Buffer.from([0x0D, 0x0A])
    ]);

    console.log("LOGIN PACKET:", packet.toString("hex").toUpperCase());
    return packet;
}

client.connect(PORT, HOST, () => {
    console.log("Connected to server");
    client.write(buildLoginPacket());
});

client.on("data", (data) => {
    console.log("ACK:", data.toString("hex").toUpperCase());
});
