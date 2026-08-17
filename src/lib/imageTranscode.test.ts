import { describe, expect, it } from 'vitest';
import { fitWithin, needsTranscode } from './imageTranscode';

/**
 * The regression these cover: an iPhone photograph handed over as HEIC was
 * refused by the upload as an unsupported file, with nothing to tell a seller
 * which of their pictures would work — some pickers transcode to JPEG on the way
 * out and some do not, so the same phone could succeed and fail on consecutive
 * photographs.
 */
describe('deciding what has to be converted', () => {
  it('recognises what an iPhone hands over', () => {
    expect(needsTranscode({ name: 'IMG_0001.HEIC', type: 'image/heic' })).toBe(true);
    expect(needsTranscode({ name: 'photo.heif', type: 'image/heif' })).toBe(true);
  });

  it('falls back to the extension when the picker states no type', () => {
    // Some pickers hand over an empty `type`, which would otherwise pass here
    // and be refused by the server instead.
    expect(needsTranscode({ name: 'IMG_0002.HEIC', type: '' })).toBe(true);
  });

  it('leaves formats the upload already accepts alone', () => {
    expect(needsTranscode({ name: 'stone.jpg', type: 'image/jpeg' })).toBe(false);
    expect(needsTranscode({ name: 'stone.png', type: 'image/png' })).toBe(false);
    expect(needsTranscode({ name: 'cert.pdf', type: 'application/pdf' })).toBe(false);
  });

  it('does not convert a JPEG whose name merely mentions heic', () => {
    expect(needsTranscode({ name: 'heic-to-jpeg.jpg', type: 'image/jpeg' })).toBe(false);
  });
});

describe('fitting a photograph inside the upload limit', () => {
  it('leaves anything already small enough untouched', () => {
    expect(fitWithin(1600, 1200, 3_000)).toEqual({ width: 1600, height: 1200 });
  });

  it('scales the long edge down and keeps the aspect ratio', () => {
    // A 12MP portrait photograph, which is what a phone camera actually produces.
    expect(fitWithin(3024, 4032, 3_000)).toEqual({ width: 2250, height: 3000 });
  });

  it('measures the long edge whichever way the photo is turned', () => {
    expect(fitWithin(4032, 3024, 3_000)).toEqual({ width: 3000, height: 2250 });
  });

  it('never rounds a dimension to zero', () => {
    // A canvas of zero width throws rather than producing an empty image, so an
    // extreme panorama must still land on at least one pixel.
    expect(fitWithin(10_000, 3, 3_000).height).toBeGreaterThanOrEqual(1);
  });
});
