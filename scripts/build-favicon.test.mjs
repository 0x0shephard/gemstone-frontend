import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BACKGROUND, FACETS, VIEWBOX, inside, renderPixel } from './build-favicon.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SVG = readFileSync(resolve(HERE, '../public/favicon.svg'), 'utf8');

/** Pulls the triangles back out of the SVG so the two definitions can be compared. */
function svgFacets() {
  return [...SVG.matchAll(/\sd="([^"]+)"/g)].map(([, d]) =>
    [...d.matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g)].map(([, x, y]) => [Number(x), Number(y)]),
  );
}

describe('favicon geometry', () => {
  /**
   * The gem is defined twice — once as SVG for browsers, once as coordinates for
   * the PNG rasteriser, because five triangles do not justify an SVG rendering
   * dependency in the build. This is what stops the two drifting apart, which
   * would otherwise show up as a home-screen icon that quietly stopped matching
   * the tab icon.
   */
  it('matches the shape drawn in favicon.svg', () => {
    const fromSvg = svgFacets();
    expect(fromSvg).toHaveLength(FACETS.length);
    fromSvg.forEach((points, index) => {
      expect(points).toEqual(FACETS[index].points);
    });
  });

  it('fills the canvas and stays centred horizontally', () => {
    const xs = FACETS.flatMap((facet) => facet.points.map(([x]) => x));
    const ys = FACETS.flatMap((facet) => facet.points.map(([, y]) => y));
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);

    // Symmetric about the vertical axis — a gem visibly off-centre in a tab
    // reads as a rendering fault rather than a design choice.
    expect(left + right).toBeCloseTo(VIEWBOX, 1);
    // Comfortably inset on every side, but not lost in its own padding.
    expect(left).toBeGreaterThan(1.5);
    expect(VIEWBOX - bottom).toBeGreaterThan(1.5);
    expect(right - left).toBeGreaterThan(VIEWBOX * 0.7);
    expect(bottom - top).toBeGreaterThan(VIEWBOX * 0.6);
  });

  it('tiles without gaps, so no background shows through the stone', () => {
    // A point just inside the girdle must belong to some facet. Gaps between
    // adjacent triangles would show as a hairline of cream across the gem.
    for (const [x, y] of [
      [16, 11],
      [8, 12],
      [24, 12],
      [16, 6],
      [16, 20],
    ]) {
      expect(FACETS.some((facet) => inside(facet.points, x, y))).toBe(true);
    }
  });

  it('renders the stone against the vault background', () => {
    expect(renderPixel(2, 2, 180)).toEqual(BACKGROUND);
    // Dead centre sits in the pavilion, which is the darkest facet.
    const [r, g, b] = renderPixel(90, 110, 180);
    expect(r + g + b).toBeLessThan(BACKGROUND[0] + BACKGROUND[1] + BACKGROUND[2]);
  });
});
