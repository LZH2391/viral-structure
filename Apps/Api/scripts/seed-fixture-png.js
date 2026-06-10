const zlib = require("zlib");

function pngBuffer(hexColor) {
  const { r, g, b } = parseHexColor(hexColor);
  const width = 24;
  const height = 14;
  const rawRows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4;
      const highlight = x < width / 2 && y < height / 2 ? 24 : 0;
      row[offset] = Math.min(255, r + highlight);
      row[offset + 1] = Math.min(255, g + highlight);
      row[offset + 2] = Math.min(255, b + highlight);
      row[offset + 3] = 255;
    }
    rawRows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", Buffer.concat([
      uint32(width),
      uint32(height),
      Buffer.from([8, 6, 0, 0, 0]),
    ])),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rawRows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function parseHexColor(value) {
  const match = /^#?([a-f0-9]{6})$/i.exec(String(value ?? ""));
  const hex = match?.[1] ?? "555555";
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  return Buffer.concat([
    uint32(data.length),
    typeBuffer,
    data,
    uint32(crc32(Buffer.concat([typeBuffer, data]))),
  ]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

module.exports = { pngBuffer };
