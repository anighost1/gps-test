import dgram from 'dgram';

const server = dgram.createSocket('udp4');

server.on('message', (msg, rinfo) => {
    console.log(`Received ${msg.length} bytes from ${rinfo.address}:${rinfo.port}`);
    console.log('Message:', msg.toString());

    // If device expects ACK:
    // server.send(Buffer.from('ACK'), rinfo.port, rinfo.address);
});

const PORT = 5002;
server.bind(PORT, () => {
    console.log(`UDP server listening on port ${PORT}`);
});