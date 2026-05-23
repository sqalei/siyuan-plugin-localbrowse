const fs = require('fs');
const buffer = fs.readFileSync('package.zip');
let offset = 0;
let count = 0;
let hasBackslash = false;
while (offset < buffer.length - 30) {
    if (buffer[offset] === 0x50 && buffer[offset+1] === 0x4B && buffer[offset+2] === 0x03 && buffer[offset+3] === 0x04) {
        const nameLen = buffer.readUInt16LE(offset + 26);
        const nameStart = offset + 30;
        const name = buffer.slice(nameStart, nameStart + nameLen).toString('utf8');
        if (name.indexOf('\\') !== -1) hasBackslash = true;
        console.log(name);
        count++;
        const compSize = buffer.readUInt32LE(offset + 18);
        const extraLen = buffer.readUInt16LE(offset + 28);
        offset = nameStart + nameLen + extraLen + compSize;
    } else {
        offset++;
    }
}
console.log('Total entries:', count);
console.log('Has backslash:', hasBackslash);
