import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";

const width = 1200;
const height = 405;
const outputDir = join(process.cwd(), "public/line");

const font = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
};

const registeredPanels = [
  { label: "PAY", from: [10, 105, 225], to: [18, 168, 232] },
  { label: "STATUS", from: [12, 87, 197], to: [27, 136, 225] },
  { label: "HISTORY", from: [4, 120, 175], to: [14, 165, 210] },
  { label: "TOTAL", from: [8, 145, 178], to: [34, 197, 229] },
];
const registerPanels = [
  { label: "REGISTER", from: [10, 105, 225], to: [18, 168, 232] },
];

writeMenuImage(join(outputDir, "rich-menu-registered.png"), registeredPanels);
writeMenuImage(join(outputDir, "rich-menu-register.png"), registerPanels);

function writeMenuImage(outputPath, panels) {
  const panelWidth = width / panels.length;
  const bytes = Buffer.alloc((width * 3 + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    bytes[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const panelIndex = Math.min(Math.floor(x / panelWidth), panels.length - 1);
      const panel = panels[panelIndex];
      const localX = (x - panelIndex * panelWidth) / panelWidth;
      const localY = y / height;
      const mix = Math.min(1, Math.max(0, localX * 0.55 + localY * 0.35));
      const shade = y < 4 || x % panelWidth < 2 ? 0.72 : 1;
      const r = Math.round((panel.from[0] * (1 - mix) + panel.to[0] * mix) * shade);
      const g = Math.round((panel.from[1] * (1 - mix) + panel.to[1] * mix) * shade);
      const b = Math.round((panel.from[2] * (1 - mix) + panel.to[2] * mix) * shade);
      const pixelStart = rowStart + 1 + x * 3;
      bytes[pixelStart] = r;
      bytes[pixelStart + 1] = g;
      bytes[pixelStart + 2] = b;
    }
  }

  for (let i = 0; i < panels.length; i += 1) {
    drawText(bytes, panels[i].label, i * panelWidth + panelWidth / 2, 198, 4, [255, 255, 255]);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, encodePng(width, height, bytes));
}

function drawText(bytes, text, centerX, centerY, scale, color) {
  const chars = [...text];
  const glyphWidth = 5 * scale;
  const glyphGap = 2 * scale;
  const spaceWidth = 4 * scale;
  const textWidth = chars.reduce((sum, char) => sum + (char === " " ? spaceWidth : glyphWidth + glyphGap), 0) - glyphGap;
  let x = Math.round(centerX - textWidth / 2);
  const y = Math.round(centerY - (7 * scale) / 2);

  for (const char of chars) {
    if (char === " ") {
      x += spaceWidth;
      continue;
    }
    const glyph = font[char];
    if (!glyph) continue;
    for (let gy = 0; gy < glyph.length; gy += 1) {
      for (let gx = 0; gx < glyph[gy].length; gx += 1) {
        if (glyph[gy][gx] !== "1") continue;
        fillRect(bytes, x + gx * scale, y + gy * scale, scale, scale, color);
      }
    }
    x += glyphWidth + glyphGap;
  }
}

function fillRect(bytes, x, y, rectWidth, rectHeight, color) {
  for (let py = Math.max(0, y); py < Math.min(height, y + rectHeight); py += 1) {
    for (let px = Math.max(0, x); px < Math.min(width, x + rectWidth); px += 1) {
      const pixelStart = py * (width * 3 + 1) + 1 + px * 3;
      bytes[pixelStart] = color[0];
      bytes[pixelStart + 1] = color[1];
      bytes[pixelStart + 2] = color[2];
    }
  }
}

function encodePng(pngWidth, pngHeight, rawBytes) {
  const chunks = [
    chunk("IHDR", Buffer.concat([
      uint32(pngWidth),
      uint32(pngHeight),
      Buffer.from([8, 2, 0, 0, 0]),
    ])),
    chunk("IDAT", deflateSync(rawBytes, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ];
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  return Buffer.concat([uint32(data.length), typeBuffer, data, uint32(crc32(Buffer.concat([typeBuffer, data])))]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
