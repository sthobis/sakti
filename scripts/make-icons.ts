// Draws the Sakti icon (an amber lightning bolt on a violet rounded square)
// and writes icons/icon{16,32,48,128}.png. No dependencies: a supersampling
// rasterizer and a minimal PNG encoder.
//   npm run icons

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

type RGB = [number, number, number];
type Point = [number, number];

const OUT = path.resolve(import.meta.dirname, "..", "icons");
const SIZES = [16, 32, 48, 128];
const BACKGROUND: RGB = [0x5b, 0x21, 0xb6];
const BOLT_COLOR: RGB = [0xff, 0xd1, 0x4a];
const SAMPLES = 4; // per axis, per pixel
// Shapes live in a 24x24 design space.
const BOLT: Point[] = [[13.5, 2], [5, 13.5], [11, 13.5], [9.5, 22], [19, 9.5], [13, 9.5]];

function inPolygon(polygon: Point[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inRoundedSquare(x: number, y: number): boolean {
  const lo = 1;
  const hi = 23;
  const radius = 5;
  if (x < lo || x > hi || y < lo || y > hi) return false;
  const cx = Math.min(Math.max(x, lo + radius), hi - radius);
  const cy = Math.min(Math.max(y, lo + radius), hi - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([length, body, crc]);
}

function render(size: number): Buffer {
  const rowBytes = size * 4 + 1;
  const raw = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y++) {
    raw[y * rowBytes] = 0; // PNG filter: none
    for (let x = 0; x < size; x++) {
      let square = 0;
      let bolt = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const dx = ((x + (sx + 0.5) / SAMPLES) * 24) / size;
          const dy = ((y + (sy + 0.5) / SAMPLES) * 24) / size;
          if (!inRoundedSquare(dx, dy)) continue;
          square++;
          if (inPolygon(BOLT, dx, dy)) bolt++;
        }
      }
      const mix = square ? bolt / square : 0;
      const offset = y * rowBytes + 1 + x * 4;
      for (let c = 0; c < 3; c++) raw[offset + c] = Math.round(BACKGROUND[c] + (BOLT_COLOR[c] - BACKGROUND[c]) * mix);
      raw[offset + 3] = Math.round((square / (SAMPLES * SAMPLES)) * 255);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  fs.writeFileSync(path.join(OUT, `icon${size}.png`), render(size));
  console.log(`icons/icon${size}.png`);
}
