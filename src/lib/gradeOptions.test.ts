import { describe, expect, it } from 'vitest';
import { gradeLabel, gradeOptions } from './gradeOptions';

describe('grade options from the matrix document', () => {
  // The shape `matrixDocument` serves: bigints as strings, terms in lower case.
  const document = {
    version: 'digital-carat-matrix-v3',
    varieties: {
      emerald: {
        basePricePerCaratUsd: '1000',
        colors: ['green'],
        colorGrades: ['bluish green', 'deep green', 'light green'],
      },
    },
    clarityPpm: { vs: '1150000', vvs: '1450000' },
    treatmentPpm: { heated: '600000', 'no oil': '1150000' },
    shapes: ['cushion', 'emerald cut'],
  };

  it('offers exactly the vocabulary the matrix document prices', () => {
    const options = gradeOptions(document);
    expect(options).toBeDefined();
    expect(options!.shapes).toEqual(['cushion', 'emerald cut']);
    expect(options!.clarities).toEqual(['vs', 'vvs']);
    expect(options!.treatments).toEqual(['heated', 'no oil']);
    const emerald = options!.varieties.find((variety) => variety.name === 'emerald');
    expect(emerald).toEqual({
      name: 'emerald',
      colors: ['green'],
      colorGrades: ['bluish green', 'deep green', 'light green'],
    });
  });

  it('falls back to free text when the document has no usable vocabulary', () => {
    expect(gradeOptions(undefined)).toBeUndefined();
    expect(gradeOptions({ varieties: {} })).toBeUndefined();
  });

  it('labels clarity codes in capitals and other terms in sentence case', () => {
    expect(gradeLabel('vvs')).toBe('VVS');
    expect(gradeLabel('si1')).toBe('SI1');
    expect(gradeLabel('emerald cut')).toBe('Emerald cut');
  });
});
