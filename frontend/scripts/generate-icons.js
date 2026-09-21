import fs from 'fs';
import zlib from 'zlib';

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type);
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function createPng(width, height, isMaskable = false) {
  const rowSize = 1 + width * 4;
  const raw = Buffer.alloc(rowSize * height);
  const cx = width / 2;
  const cy = height / 2;
  const radius = width * 0.46;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    raw[rowOffset] = 0; // Filter 0
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Background color: #1B4D3E (27, 77, 62)
      let r = 27, g = 77, b = 62, a = 255;

      if (!isMaskable) {
        // Rounded corner icon
        const cornerR = width * 0.22;
        const inCorner =
          (x < cornerR && y < cornerR && Math.hypot(x - cornerR, y - cornerR) > cornerR) ||
          (x > width - cornerR && y < cornerR && Math.hypot(x - (width - cornerR), y - cornerR) > cornerR) ||
          (x < cornerR && y > height - cornerR && Math.hypot(x - cornerR, y - (height - cornerR)) > cornerR) ||
          (x > width - cornerR && y > height - cornerR && Math.hypot(x - (width - cornerR), y - (height - cornerR)) > cornerR);
        if (inCorner) {
          a = 0;
        }
      }

      if (a > 0) {
        // Shield shape in center
        const ny = (y - cy) / (width * 0.38);
        const nx = (x - cx) / (width * 0.34);
        // Shield bounds: nx^2 + (ny - 0.2)^2 < 1 or triangular bottom
        const inShield = (Math.abs(nx) <= 1 - (ny > 0 ? ny * 0.7 : 0)) && (ny >= -0.8 && ny <= 0.95);
        if (inShield) {
          // Inside shield: brighter emerald / gold accent
          const isBorder = (Math.abs(nx) >= 0.85 - (ny > 0 ? ny * 0.65 : 0)) || ny <= -0.7 || ny >= 0.85;
          if (isBorder) {
            r = 234; g = 179; b = 8; // Gold #EAB308
          } else {
            r = 20; g = 60; b = 48; // Dark emerald core
            // Checkmark in center
            // check segment: (-0.3, 0.1) to (0, 0.4) to (0.45, -0.2)
            const check1Dist = Math.abs((ny - 0.1) - (nx - -0.3));
            const check2Dist = Math.abs((ny - 0.4) + (nx - 0) * 1.33);
            if ((nx >= -0.25 && nx <= 0.05 && check1Dist < 0.12 && ny >= 0.05 && ny <= 0.42) ||
                (nx >= -0.02 && nx <= 0.38 && check2Dist < 0.13 && ny >= -0.25 && ny <= 0.42)) {
              r = 74; g = 222; b = 128; // Green #4ADE80
            }
          }
        }
      }

      raw[pxOffset] = r;
      raw[pxOffset + 1] = g;
      raw[pxOffset + 2] = b;
      raw[pxOffset + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(raw);
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    header,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

fs.writeFileSync('public/pwa-192x192.png', createPng(192, 192, false));
fs.writeFileSync('public/pwa-512x512.png', createPng(512, 512, false));
fs.writeFileSync('public/pwa-maskable-512x512.png', createPng(512, 512, true));
fs.writeFileSync('public/apple-touch-icon.png', createPng(180, 180, false));
fs.writeFileSync('public/favicon.ico', createPng(64, 64, false));
console.log('Icons generated successfully in public/');
