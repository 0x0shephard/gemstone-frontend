import qrcode from 'qrcode-generator';

export interface QrMatrix {
  /** SVG path data covering every dark module, in a `modules`-unit square. */
  path: string;
  /** Width of the symbol in modules, excluding the quiet zone. */
  modules: number;
}

/**
 * Encodes text as QR path data.
 *
 * Returned as one `<path>` rather than a grid of rects because the card is
 * exported to PNG by rasterising its SVG, and a few thousand sibling elements
 * is the difference between an export that feels instant and one that visibly
 * stalls the tab.
 *
 * Error correction is fixed at Q (25%). These codes are printed, handled, and
 * sometimes folded, and a claim link is not worth re-issuing because a crease
 * fell across a timing pattern.
 */
export function qrMatrix(text: string): QrMatrix {
  const qr = qrcode(0, 'Q');
  qr.addData(text);
  qr.make();

  const modules = qr.getModuleCount();
  const parts: string[] = [];
  for (let row = 0; row < modules; row += 1) {
    for (let column = 0; column < modules; column += 1) {
      // Runs of adjacent dark modules collapse into one rectangle, which cuts
      // the path length roughly in half on a typical symbol.
      if (!qr.isDark(row, column)) continue;
      let run = 1;
      while (column + run < modules && qr.isDark(row, column + run)) run += 1;
      parts.push(`M${column} ${row}h${run}v1h-${run}z`);
      column += run - 1;
    }
  }
  return { path: parts.join(''), modules };
}
