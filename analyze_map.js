const fs = require('fs');

// Decode Shift-JIS sannkou.txt using a simple manual mapping if common characters are found, 
// or just print raw bytes to help me identify numbers.
function decodeSannkou() {
    console.log('--- sannkou.txt ---');
    if (!fs.existsSync('sannkou.txt')) {
        console.log('sannkou.txt not found');
        return;
    }
    const buf = fs.readFileSync('sannkou.txt');
    // Try to find numbers and labels
    console.log('Raw Bytes:', buf.toString('hex').match(/.{1,32}/g).join('\n'));
    // Try to print it as is, maybe the environment handles it somehow
    console.log('Content:', buf.toString());
}

function analyzeCSV() {
    console.log('--- mario_1_1_map.csv ---');
    if (!fs.existsSync('mario_1_1_map.csv')) {
        console.log('mario_1_1_map.csv not found');
        return;
    }
    const content = fs.readFileSync('mario_1_1_map.csv', 'utf-8');
    const lines = content.trim().split(/\r?\n/).filter(l => l.length > 0);
    const map = lines.map(l => l.split(',').map(v => v.trim()));

    const height = map.length;
    const width = map[0].length;
    console.log(`Dimensions: ${width}x${height}`);

    const counts = {};
    const samples = {};
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < map[y].length; x++) {
            const v = map[y][x];
            if (v === '') continue;
            counts[v] = (counts[v] || 0) + 1;
            if (!samples[v]) samples[v] = [];
            if (samples[v].length < 10) samples[v].push({ x, y });
        }
    }

    for (const v in counts) {
        console.log(`Value [${v}]: count ${counts[v]}`);
        console.log(`  Samples: ${samples[v].map(s => `${s.x},${s.y}`).join('  ')}`);
    }
}

decodeSannkou();
analyzeCSV();
