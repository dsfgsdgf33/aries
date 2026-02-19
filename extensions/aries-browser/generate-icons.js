// Generate minimal PNG icons (no dependencies needed)
// PNG files: cyan (#00e5ff) square on dark (#0a0a1a) background
const fs = require('fs');
const path = require('path');

function createPNG(size) {
  // Minimal valid PNG with solid color
  const bg = [10, 10, 26]; // #0a0a1a
  const fg = [0, 229, 255]; // #00e5ff
  
  // Raw RGBA pixel data
  const pixels = Buffer.alloc(size * size * 4);
  const border = Math.max(1, Math.floor(size * 0.15));
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Draw "A" shape roughly
      const cx = x / size, cy = y / size;
      let isFg = false;
      
      // Simple A: two legs + crossbar
      const legWidth = 0.15;
      // Left leg: from bottom-left to top-center
      const leftLegX = 0.1 + cy * 0.35;
      if (Math.abs(cx - leftLegX) < legWidth / 2 && cy > 0.15) isFg = true;
      // Right leg: from bottom-right to top-center  
      const rightLegX = 0.9 - cy * 0.35;
      if (Math.abs(cx - rightLegX) < legWidth / 2 && cy > 0.15) isFg = true;
      // Crossbar
      if (cy > 0.5 && cy < 0.6 && cx > leftLegX && cx < rightLegX) isFg = true;
      // Top point
      if (cy > 0.1 && cy < 0.25 && Math.abs(cx - 0.5) < 0.12) isFg = true;

      const c = isFg ? fg : bg;
      pixels[i] = c[0]; pixels[i+1] = c[1]; pixels[i+2] = c[2]; pixels[i+3] = 255;
    }
  }

  // Build PNG manually
  const { deflateSync } = require('zlib');
  
  // Filter: prepend 0 (None) to each row
  const filtered = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    filtered[y * (size * 4 + 1)] = 0; // filter none
    pixels.copy(filtered, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  
  const compressed = deflateSync(filtered);
  
  function chunk(type, data) {
    const buf = Buffer.alloc(4 + type.length + data.length + 4);
    buf.writeUInt32BE(data.length, 0);
    buf.write(type, 4);
    data.copy(buf, 8);
    const crc = crc32(Buffer.concat([Buffer.from(type), data]));
    buf.writeInt32BE(crc, buf.length - 4);
    return buf;
  }

  // CRC32
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0);
    }
    return (c ^ 0xFFFFFFFF) | 0;
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const dir = path.join(__dirname, 'icons');
fs.mkdirSync(dir, { recursive: true });
for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(dir, `icon${size}.png`), createPNG(size));
  console.log(`Created icon${size}.png`);
}
