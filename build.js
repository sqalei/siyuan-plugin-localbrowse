/**
 * Build script for siyuan-plugin-localbrowse
 * Creates package.zip with forward-slash paths (required by SiYuan bazaar)
 */

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const outputFile = path.join(__dirname, 'package.zip');
const output = fs.createWriteStream(outputFile);
const archive = new archiver.ZipArchive({ zlib: { level: 9 } });

output.on('close', function() {
    console.log('package.zip created: ' + archive.pointer() + ' bytes');
});

archive.on('error', function(err) {
    throw err;
});

archive.pipe(output);

// Files to include in the zip (must use forward slashes for SiYuan compatibility)
const files = [
    'index.js',
    'index.css',
    'plugin.json',
    'icon.png',
    'icon.svg',
    'preview.png',
    'README.md',
    'README_zh_CN.md',
    'LICENSE',
    'i18n/en_US.json',
    'i18n/zh_CN.json'
];

files.forEach(function(file) {
    var filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
        // Use forward slashes for zip entry names (SiYuan requirement)
        archive.file(filePath, { name: file.replace(/\\/g, '/') });
    } else {
        console.warn('Warning: file not found: ' + file);
    }
});

archive.finalize();
