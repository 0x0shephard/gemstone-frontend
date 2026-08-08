import { describe, expect, it } from 'vitest';
import qrcode from 'qrcode-generator';
import { qrMatrix } from './qr';

/**
 * Reconstructs the module grid from the emitted path.
 *
 * The path is built by merging horizontal runs, which is exactly where a
 * coordinate or off-by-one slip hides: the symbol still renders, still looks
 * like a QR code, and simply does not scan. Reading it back and comparing
 * against the encoder is the only check that catches that before it reaches a
 * printed card.
 */
function gridFromPath(path: string, modules: number): boolean[][] {
  const grid = Array.from({ length: modules }, () => Array.from({ length: modules }, () => false));
  for (const [, x, y, run] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let offset = 0; offset < Number(run); offset += 1) {
      grid[Number(y)][Number(x) + offset] = true;
    }
  }
  return grid;
}

describe('qrMatrix', () => {
  const samples = [
    'https://app.example.com/gift/ABCD1234EFGH5678',
    'https://digital-carat.example/gift/0000000000000000',
    'x',
    'https://example.com/'.padEnd(400, 'a'),
  ];

  it.each(samples)('encodes exactly the modules the encoder produces (%#)', (text) => {
    const { path, modules } = qrMatrix(text);

    const reference = qrcode(0, 'Q');
    reference.addData(text);
    reference.make();

    expect(modules).toBe(reference.getModuleCount());
    const grid = gridFromPath(path, modules);
    for (let row = 0; row < modules; row += 1) {
      for (let column = 0; column < modules; column += 1) {
        expect(grid[row][column]).toBe(reference.isDark(row, column));
      }
    }
  });

  it('produces a symbol of a valid QR size', () => {
    // Versions run 21, 25, 29 … so anything else means the module count was
    // mishandled rather than merely mis-drawn.
    const { modules } = qrMatrix(samples[0]);
    expect(modules).toBeGreaterThanOrEqual(21);
    expect((modules - 21) % 4).toBe(0);
  });

  it('merges adjacent dark modules instead of emitting one rect each', () => {
    const { path, modules } = qrMatrix(samples[0]);
    const runs = [...path.matchAll(/h(\d+)v/g)].map(([, run]) => Number(run));
    const dark = gridFromPath(path, modules).flat().filter(Boolean).length;
    expect(runs.length).toBeLessThan(dark);
  });
});
