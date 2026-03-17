const fs = require('fs');
const iconv = require('iconv-lite');

try {
    const buffer = fs.readFileSync('sannkou.txt');
    const content = iconv.decode(buffer, 'Shift_JIS');
    console.log('--- sannkou.txt ---');
    console.log(content);
} catch (e) {
    // If iconv-lite is not installed, fallback to simpler check or instruct me
    console.log('Error: iconv-lite not found or other error. Trying native method...');
    const buffer = fs.readFileSync('sannkou.txt');
    // Simple mapping if we can't decode fully but see enough
    console.log(buffer.toString('utf-8'));
}

// Also read a bit of the CSV
const csv = fs.readFileSync('mario_1_1_map.csv', 'utf-8');
console.log('--- mario_1_1_map.csv (first lines) ---');
console.log(csv.split('\n').slice(0, 5).join('\n'));
