const fs = require('fs');
const path = require('path');

function getPngDimensions(filename) {
    const buffer = fs.readFileSync(filename);
    if (buffer.toString('utf8', 1, 4) !== 'PNG') {
        return 'Not a PNG';
    }
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return `${width}x${height}`;
}

const pipeDir = 'assets/pipe';
fs.readdirSync(pipeDir).forEach(file => {
    if (file.endsWith('.png')) {
        console.log(`${file}: ${getPngDimensions(path.join(pipeDir, file))}`);
    }
});
