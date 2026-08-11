#!/usr/bin/env node
/**
 * Rasterises the favicon gem to `public/apple-touch-icon.png`.
 *
 * iOS home-screen icons must be PNG — it will not read the SVG — and it
 * composites them onto black rather than honouring transparency, so this one is
 * drawn on the app's own cream vault background instead of a transparent field.
 *
 * The geometry is duplicated from `public/favicon.svg` rather than parsed out of
 * it: five triangles are not worth an SVG rasteriser as a build dependency, and
 * the shape is stable. If you change one, change both — the test alongside this
 * keeps the coordinates honest.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../public/apple-touch-icon.png');

/** Matches the viewBox of favicon.svg. */
export const VIEWBOX = 32;
export const BACKGROUND = [0xf8, 0xf5, 0xf0]; // --dc-vault

/**
 * The same five facets as the SVG, in the same order, light scheme only —
 * iOS shows one icon regardless of the user's colour scheme.
 */
export const FACETS = [
  { points: [[3, 10.7], [10.7, 4.8], [16, 10.7]], fill: [0x0b, 0x5d, 0x4b] },
  { points: [[10.7, 4.8], [21.3, 4.8], [16, 10.7]], fill: [0x2e, 0x8f, 0x76] },
  { points: [[21.3, 4.8], [29, 10.7], [16, 10.7]], fill: [0x0b, 0x5d, 0x4b] },
  { points: [[3, 10.7], [16, 10.7], [16, 27.2]], fill: [0x05, 0x37, 0x2c] },
  { points: [[16, 10.7], [29, 10.7], [16, 27.2]], fill: [0x0b, 0x5d, 0x4b] },
];

/** Standard crossing-number test. Edges are half-open so shared edges do not double-count. */
export function inside(polygon, x, y) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
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

function chunk(kind, data) {
  const body = Buffer.concat([Buffer.from(kind, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/**
 * Supersampled so the pavilion's diagonals do not stair-step. Four samples per
 * axis is the point where the edges stop reading as jagged at icon sizes.
 */
const SAMPLES = 4;

export function renderPixel(x, y, size) {
  let r = 0;
  let g = 0;
  let b = 0;
  for (let sy = 0; sy < SAMPLES; sy += 1) {
    for (let sx = 0; sx < SAMPLES; sx += 1) {
      const ux = ((x + (sx + 0.5) / SAMPLES) / size) * VIEWBOX;
      const uy = ((y + (sy + 0.5) / SAMPLES) / size) * VIEWBOX;
      // Last facet wins, matching SVG paint order.
      let colour = BACKGROUND;
      for (const facet of FACETS) if (inside(facet.points, ux, uy)) colour = facet.fill;
      r += colour[0];
      g += colour[1];
      b += colour[2];
    }
  }
  const total = SAMPLES * SAMPLES;
  return [Math.round(r / total), Math.round(g / total), Math.round(b / total)];
}

function writePng(path, size) {
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0; // filter: None
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = renderPixel(x, y, size);
      const at = y * stride + 1 + x * 3;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(dirname(OUT), { recursive: true });
  writePng(OUT, 180);
  console.log(`Wrote ${OUT}`);
}
