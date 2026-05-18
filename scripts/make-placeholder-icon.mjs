/**
 * Generate a 1024x1024 placeholder PNG for the app icon.
 * Used only until a real icon ships. Run: node scripts/make-placeholder-icon.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import zlib from 'node:zlib';

const SIZE = 1024;
const BG = [0x37, 0x8a, 0xdd]; // primary blue from the mockups

function crc32(buf) {
  let c;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    crc = (table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihd = Buffer.alloc(13);
ihd.writeUInt32BE(SIZE, 0);
ihd.writeUInt32BE(SIZE, 4);
ihd[8] = 8; // bit depth
ihd[9] = 2; // color type RGB
ihd[10] = 0;
ihd[11] = 0;
ihd[12] = 0;
const ihdr = chunk('IHDR', ihd);

const rowSize = SIZE * 3 + 1;
const raw = Buffer.alloc(rowSize * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * rowSize] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const off = y * rowSize + 1 + x * 3;
    raw[off] = BG[0];
    raw[off + 1] = BG[1];
    raw[off + 2] = BG[2];
  }
}
const idat = chunk('IDAT', zlib.deflateSync(raw, { level: 9 }));
const iend = chunk('IEND', Buffer.alloc(0));
const png = Buffer.concat([sig, ihdr, idat, iend]);

const outPath = resolve(process.cwd(), 'src-tauri/icons/app-icon.png');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, png);
console.log(`Wrote ${outPath} (${png.length} bytes)`);
