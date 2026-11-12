import { mkdirSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function draw(size, maskable) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, color) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = color[0];
    px[i + 1] = color[1];
    px[i + 2] = color[2];
    px[i + 3] = 255;
  };
  const paper = [243, 239, 230];
  const blue = [26, 115, 232];
  const cream = [255, 252, 247];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) set(x, y, maskable ? blue : paper);
  }
  const margin = Math.round(size * (maskable ? 0.22 : 0.14));
  roundRect(set, margin, margin, size - margin * 2, size - margin * 2, Math.round(size * 0.08), maskable ? cream : blue);
  const inset = Math.round(size * 0.07);
  roundRect(
    set,
    margin + inset,
    margin + inset,
    size - (margin + inset) * 2,
    size - (margin + inset) * 2,
    Math.round(size * 0.04),
    maskable ? paper : cream,
  );
  const line = maskable ? blue : [26, 115, 232];
  const left = margin + inset * 2;
  const width = size - left * 2;
  const thickness = Math.max(2, Math.round(size * 0.012));
  for (let row = 0; row < 4; row += 1) {
    const y = margin + inset * 2 + Math.round((size - margin * 2 - inset * 4) * (0.28 + row * 0.16));
    for (let x = left; x < left + width; x += 1) {
      for (let t = 0; t < thickness; t += 1) set(x, y + t, line);
    }
  }
  return px;
}

function roundRect(set, x, y, w, h, radius, color) {
  const r = Math.min(radius, Math.floor(w / 2), Math.floor(h / 2));
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      const dx = xx < x + r ? x + r - xx : xx >= x + w - r ? xx - (x + w - r - 1) : 0;
      const dy = yy < y + r ? y + r - yy : yy >= y + h - r ? yy - (y + h - r - 1) : 0;
      if (dx === 0 || dy === 0 || dx * dx + dy * dy <= r * r) set(xx, yy, color);
    }
  }
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", png(192, 192, draw(192, false)));
writeFileSync("public/icons/icon-512.png", png(512, 512, draw(512, false)));
writeFileSync("public/icons/icon-maskable-512.png", png(512, 512, draw(512, true)));
