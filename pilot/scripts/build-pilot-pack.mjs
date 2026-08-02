#!/usr/bin/env node
/**
 * Regenerates the pilot pack: stone photographs, mock certificates, and the
 * expected valuations in `stones.json`.
 *
 * The expected figures are computed by importing the real `valuationMath.ts`,
 * never restated here. A matrix change alters prices, and a pack carrying
 * hand-copied numbers would quietly assert the wrong thing — which is worse than
 * having no fixtures, because it looks like a passing check.
 *
 * Run after any change to `_shared/valuationMatrix.ts`:
 *
 *   node pilot/scripts/build-pilot-pack.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const PILOT = resolve(HERE, '..');
const SHARED = resolve(PILOT, '../supabase/functions/_shared');
const USD = 10n ** 18n;

// ---------------------------------------------------------------------- PNG

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

function writePng(path, size, pixel) {
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0; // filter: None
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixel(x, y);
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

const clamp = (value) => (value < 0 ? 0 : value > 255 ? 255 : Math.round(value));

/** A faceted stone: flat table, angular crown facets, one specular highlight. */
function gemRenderer([br, bg, bb], { facets = 14, seed = 7, size = 640 } = {}) {
  const centre = size / 2;
  const outer = size * 0.4;
  return (x, y) => {
    const dx = x - centre;
    const dy = y - centre;
    const radius = Math.hypot(dx, dy);

    if (radius > outer) {
      const fade = Math.min(1, (radius - outer) / (size * 0.5));
      const level = 26 - 14 * fade;
      return [clamp(level), clamp(level + 1), clamp(level + 3)];
    }

    const theta = Math.atan2(dy, dx) + Math.PI;
    const wedge = Math.floor((theta / (2 * Math.PI)) * facets) % facets;
    const jitter = ((wedge * 37 + seed * 13) % 11) / 11;
    const norm = radius / outer;

    let shade;
    if (norm < 0.42) {
      shade = 1.1 + 0.16 * jitter;
    } else {
      const t = (norm - 0.42) / 0.58;
      shade = 0.62 + 0.5 * jitter + 0.3 * (1 - t);
    }

    const hx = centre - outer * 0.34;
    const hy = centre - outer * 0.38;
    const spec = Math.max(0, 1 - Math.hypot(x - hx, y - hy) / (outer * 0.44)) ** 2.4;
    const edge = 1 - Math.max(0, (norm - 0.94) / 0.06) * 0.55;

    return [
      clamp((br * shade + 210 * spec) * edge),
      clamp((bg * shade + 210 * spec) * edge),
      clamp((bb * shade + 215 * spec) * edge),
    ];
  };
}

// ---------------------------------------------------------------------- PDF

const escapePdf = (text) =>
  String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function writePdf(path, title, rows) {
  const lines = [
    `BT /F2 20 Tf 62 742 Td (${escapePdf(title)}) Tj ET`,
    '0.6 w 62 730 m 534 730 l S',
  ];
  let y = 700;
  for (const [label, value] of rows) {
    lines.push(`BT /F2 10 Tf 62 ${y} Td (${escapePdf(label)}) Tj ET`);
    lines.push(`BT /F1 11 Tf 210 ${y} Td (${escapePdf(value)}) Tj ET`);
    y -= 26;
  }
  lines.push(`0.6 w 62 ${y - 6} m 534 ${y - 6} l S`);
  lines.push(
    `BT /F1 8.5 Tf 62 ${y - 26} Td (Synthetic document generated for pilot testing of the Digital Carat verification flow.) Tj ET`,
  );
  lines.push(
    `BT /F1 8.5 Tf 62 ${y - 40} Td (Not a gemmological certificate. No laboratory issued or endorsed this file.) Tj ET`,
  );
  const stream = Buffer.from(lines.join('\n'), 'latin1');

  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 596 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    ),
    Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
      stream,
      Buffer.from('\nendstream'),
    ]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'),
  ];

  const parts = [Buffer.from('%PDF-1.4\n')];
  const offsets = [];
  let cursor = parts[0].length;
  objects.forEach((body, index) => {
    offsets.push(cursor);
    const object = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      body,
      Buffer.from('\nendobj\n'),
    ]);
    parts.push(object);
    cursor += object.length;
  });

  const xref = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n']
    .concat(offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`))
    .join('');
  parts.push(Buffer.from(xref));
  parts.push(
    Buffer.from(
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${cursor}\n%%EOF\n`,
    ),
  );
  writeFileSync(path, Buffer.concat(parts));
}

// ---------------------------------------------------------------------- pack

const STONES = [
  {
    ref: 'PILOT-RUBY-01',
    note: 'Straightforward mid-range stone. Carat interpolates between the 1.0 and 2.0 anchors.',
    saleMode: 'buy_now',
    rgb: [196, 32, 62],
    seed: 7,
    species: 'Corundum',
    seller: {
      name: 'Pilot Ruby 01',
      gemstoneType: 'Ruby',
      caratWeight: 1.5,
      origin: 'Mozambique',
      dimensions: '7.4 x 5.6 x 3.8 mm',
      color: 'Red',
      clarity: 'VS',
      cut: 'Round',
      treatment: 'Unheated',
      gradingLab: 'Pilot Gem Lab',
      certificateNumber: 'PILOT-RUBY-01-CERT',
    },
    graded: {
      variety: 'ruby',
      caratWeight: 1.5,
      clarity: 'vs',
      treatment: 'unheated',
      shape: 'round',
      color: 'red',
      colorGrade: 'medium',
    },
  },
  {
    ref: 'PILOT-SAPPHIRE-02',
    note: 'Sits exactly on the 2.0 ct anchor (2.4x), the value where the matrix table deliberately overrides the source document worked example.',
    saleMode: 'auction',
    rgb: [34, 78, 198],
    seed: 3,
    species: 'Corundum',
    seller: {
      name: 'Pilot Sapphire 02',
      gemstoneType: 'Sapphire',
      caratWeight: 2,
      origin: 'Sri Lanka',
      dimensions: '8.1 x 6.9 x 4.4 mm',
      color: 'Blue',
      clarity: 'VVS',
      cut: 'Cushion',
      treatment: 'Unheated',
      gradingLab: 'Pilot Gem Lab',
      certificateNumber: 'PILOT-SAPPHIRE-02-CERT',
    },
    graded: {
      variety: 'sapphire',
      caratWeight: 2,
      clarity: 'vvs',
      treatment: 'unheated',
      shape: 'cushion',
      color: 'blue',
      colorGrade: 'dark',
    },
  },
  {
    ref: 'PILOT-EMERALD-03',
    note: 'Lower carat bound, exactly 0.5 ct. Anything below is refused.',
    saleMode: 'buy_now',
    rgb: [22, 158, 96],
    seed: 5,
    species: 'Beryl',
    seller: {
      name: 'Pilot Emerald 03',
      gemstoneType: 'Emerald',
      caratWeight: 0.5,
      origin: 'Colombia',
      dimensions: '5.2 x 4.1 x 2.7 mm',
      color: 'Green',
      clarity: 'SI1',
      cut: 'Emerald cut',
      treatment: 'Oiled',
      gradingLab: 'Pilot Gem Lab',
      certificateNumber: 'PILOT-EMERALD-03-CERT',
    },
    graded: {
      variety: 'emerald',
      caratWeight: 0.5,
      clarity: 'si1',
      treatment: 'oiled',
      shape: 'emerald cut',
      color: 'green',
      colorGrade: 'deep green',
    },
  },
  {
    ref: 'PILOT-PERIDOT-04',
    note: 'Upper carat bound, exactly 5.0 ct (9.0x). Anything above is refused.',
    saleMode: 'auction',
    rgb: [148, 188, 58],
    seed: 9,
    species: 'Olivine',
    seller: {
      name: 'Pilot Peridot 04',
      gemstoneType: 'Peridot',
      caratWeight: 5,
      origin: 'Pakistan',
      dimensions: '11.2 x 9.1 x 6.0 mm',
      color: 'Green',
      clarity: 'I1',
      cut: 'Oval',
      treatment: 'Heated',
      gradingLab: 'Pilot Gem Lab',
      certificateNumber: 'PILOT-PERIDOT-04-CERT',
    },
    graded: {
      variety: 'peridot',
      caratWeight: 5,
      clarity: 'i1',
      treatment: 'heated',
      shape: 'oval',
      color: 'green',
      colorGrade: 'light',
    },
  },
  {
    ref: 'PILOT-PERIDOT-05',
    note: 'Prices to $19.80 before clamping, so it proves the $100 floor fires and that priceClamped is reported.',
    saleMode: 'buy_now',
    rgb: [126, 166, 74],
    seed: 2,
    species: 'Olivine',
    seller: {
      name: 'Pilot Peridot 05',
      gemstoneType: 'Peridot',
      caratWeight: 0.5,
      origin: 'Arizona',
      dimensions: '4.9 x 4.0 x 2.6 mm',
      color: 'Green',
      clarity: 'Dcl',
      cut: 'Cabochon',
      treatment: 'Heated',
      gradingLab: 'Pilot Gem Lab',
      certificateNumber: 'PILOT-PERIDOT-05-CERT',
    },
    graded: {
      variety: 'peridot',
      caratWeight: 0.5,
      clarity: 'dcl',
      treatment: 'heated',
      shape: 'cabochon',
      color: 'green',
      colorGrade: 'dark',
    },
  },
];

/** Inputs the engine must refuse. Each exercises a different guard. */
const REFUSALS = [
  { ref: 'REFUSAL-UNDER-CARAT', reason: 'Below the 0.5 ct floor', patch: { caratWeight: 0.25 } },
  { ref: 'REFUSAL-OVER-CARAT', reason: 'Above the 5.0 ct ceiling', patch: { caratWeight: 6 } },
  {
    ref: 'REFUSAL-UNPRICED-VARIETY',
    reason: 'Tourmaline is deliberately absent from the matrix',
    patch: { variety: 'tourmaline' },
  },
  {
    ref: 'REFUSAL-CROSS-VARIETY-COLOUR',
    reason: 'Blue is a sapphire colour; ruby does not declare it',
    patch: { color: 'blue' },
  },
];

/** The engine is Deno-flavoured TypeScript; bundle it so plain node can import it. */
async function loadEngine() {
  const bundle = resolve(PILOT, '.engine.tmp.mjs');
  await build({
    entryPoints: [resolve(SHARED, 'valuationMath.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundle,
    logLevel: 'error',
  });
  const matrixBundle = resolve(PILOT, '.matrix.tmp.mjs');
  await build({
    entryPoints: [resolve(SHARED, 'valuationMatrix.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: matrixBundle,
    logLevel: 'error',
  });
  const math = await import(`file://${bundle}`);
  const matrix = await import(`file://${matrixBundle}`);
  return {
    math,
    matrix,
    cleanup: () => {
      rmSync(bundle, { force: true });
      rmSync(matrixBundle, { force: true });
    },
  };
}

const ppm = (value) => Number(value) / 1_000_000;

async function main() {
  const { math, matrix, cleanup } = await loadEngine();
  const { calculateValuation, ValuationError } = math;
  const { VALUATION_MATRIX } = matrix;

  mkdirSync(resolve(PILOT, 'media'), { recursive: true });
  mkdirSync(resolve(PILOT, 'certificates'), { recursive: true });

  const stones = STONES.map((stone) => {
    const slug = stone.ref.toLowerCase();

    writePng(
      resolve(PILOT, `media/${slug}.png`),
      640,
      gemRenderer(stone.rgb, { seed: stone.seed }),
    );
    writePng(
      resolve(PILOT, `media/${slug}-alt.png`),
      640,
      gemRenderer(
        stone.rgb.map((channel) => Math.round(channel * 0.82)),
        { facets: 10, seed: stone.seed + 4 },
      ),
    );

    writePdf(
      resolve(PILOT, `certificates/${slug}-cert.pdf`),
      `Pilot Gem Lab - ${stone.seller.name}`,
      [
        ['Reference', stone.ref],
        ['Certificate number', stone.seller.certificateNumber],
        ['Species', stone.species],
        ['Variety', stone.seller.gemstoneType],
        ['Carat weight', `${stone.seller.caratWeight.toFixed(2)} ct`],
        ['Dimensions', stone.seller.dimensions],
        ['Colour', stone.seller.color],
        ['Clarity', stone.seller.clarity],
        ['Shape / cut', stone.seller.cut],
        ['Treatment', stone.seller.treatment],
        ['Origin', stone.seller.origin],
      ],
    );

    const valuation = calculateValuation(stone.graded, {}, VALUATION_MATRIX);
    return {
      ref: stone.ref,
      note: stone.note,
      saleMode: stone.saleMode,
      files: {
        certificate: `certificates/${slug}-cert.pdf`,
        media: [`media/${slug}.png`, `media/${slug}-alt.png`],
      },
      seller: stone.seller,
      graded: stone.graded,
      expected: {
        approvedValuationUsd: Number(valuation.priceUsd / USD),
        basePricePerCaratUsd: Number(valuation.basePricePerCaratUsd),
        caratMultiplier: ppm(valuation.caratMultiplierPpm),
        clarityMultiplier: ppm(valuation.clarityMultiplierPpm),
        treatmentMultiplier: ppm(valuation.treatmentMultiplierPpm),
        baseValueUsd: Number(valuation.baseValueUsd / USD),
        marketMultiplier: ppm(valuation.marketMultiplierPpm),
        priceClamped: valuation.priceClamped,
      },
    };
  });

  const refusals = REFUSALS.map((entry) => {
    const graded = { ...STONES[0].graded, ...entry.patch };
    try {
      calculateValuation(graded, {}, VALUATION_MATRIX);
      return { ...entry, graded, refused: false, message: 'DID NOT REFUSE — investigate' };
    } catch (error) {
      return {
        ref: entry.ref,
        reason: entry.reason,
        graded,
        refused: error instanceof ValuationError,
        message: error.message,
      };
    }
  });

  writeFileSync(
    resolve(PILOT, 'stones.json'),
    `${JSON.stringify(
      {
        matrixVersion: VALUATION_MATRIX.version,
        generatedBy: 'pilot/scripts/build-pilot-pack.mjs',
        demandAssumption:
          'No bid observations. Laplace smoothing therefore holds every market multiplier at exactly 1.0. Once v1-demand-refresh has ingested bids these figures move, and the pack must be regenerated.',
        stones,
        refusals,
      },
      null,
      2,
    )}\n`,
  );

  cleanup();

  for (const stone of stones) {
    console.log(
      `${stone.ref.padEnd(20)} $${stone.expected.approvedValuationUsd.toLocaleString().padStart(8)}` +
        `${stone.expected.priceClamped ? '  (clamped)' : ''}`,
    );
  }
  const notRefused = refusals.filter((entry) => !entry.refused);
  if (notRefused.length > 0) {
    console.error(`\nFAIL: ${notRefused.map((entry) => entry.ref).join(', ')} were not refused`);
    process.exit(1);
  }
  console.log(`\n${refusals.length} refusal cases all correctly refused.`);
}

await main();
