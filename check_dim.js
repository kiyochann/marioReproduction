const fs = require('fs');
const http = require('http');

// A simple script to read image dimensions
function getDimensions(path) {
    try {
        const buffer = fs.readFileSync(path);
        // Extremely basic PNG parsing (assuming standard PNG magic number)
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
            const width = buffer.readUInt32BE(16);
            const height = buffer.readUInt32BE(20);
            return { width, height };
        }
    } catch(e) {
        return null; // Skip errors
    }
}

const files = [
    'assets/smario/smario8_goal.png',
    'assets/mario/mario8_goal.png',
    'assets/pipe/dokan_under_left_up.png',
    'assets/pipe/dokan_under_left_down.png',
    'assets/pipe/dokan_under_right_up.png',
    'assets/pipe/dokan_under_right_down.png'
];

files.forEach(f => {
    const dim = getDimensions(f);
    if (dim) {
        console.log(`${f}: ${dim.width}x${dim.height}`);
    } else {
        console.log(`${f}: could not read dimensions`);
    }
});
