/**
 * Grading choices derived from the active valuation matrix document.
 *
 * The Gem lab form used free text, so a grader could type a colour or shape the
 * matrix has no price for and only learn it from the server's refusal. Offering
 * exactly the matrix's own vocabulary makes an unpriceable grade unreachable.
 */
export interface GradeOptions {
  varieties: Array<{ name: string; colors: string[]; colorGrades: string[] }>;
  clarities: string[];
  treatments: string[];
  shapes: string[];
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const keys = (value: unknown): string[] =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];

/** Returns undefined when the document lacks a usable vocabulary. */
export function gradeOptions(document: unknown): GradeOptions | undefined {
  if (!document || typeof document !== 'object') return undefined;
  const source = document as Record<string, unknown>;
  const varietySource = source.varieties;
  if (!varietySource || typeof varietySource !== 'object' || Array.isArray(varietySource)) {
    return undefined;
  }
  const varieties = Object.entries(varietySource as Record<string, unknown>).map(([name, spec]) => {
    const detail = (spec ?? {}) as Record<string, unknown>;
    return { name, colors: strings(detail.colors), colorGrades: strings(detail.colorGrades) };
  });
  const options = {
    varieties,
    clarities: keys(source.clarityPpm),
    treatments: keys(source.treatmentPpm),
    shapes: strings(source.shapes),
  };
  const complete =
    varieties.length > 0 &&
    varieties.every((variety) => variety.colors.length > 0 && variety.colorGrades.length > 0) &&
    options.clarities.length > 0 &&
    options.treatments.length > 0 &&
    options.shapes.length > 0;
  return complete ? options : undefined;
}

/** Display label for a lower-case matrix term: "emerald cut" -> "Emerald cut". */
export function gradeLabel(value: string): string {
  if (/^(dcl|i\d|si\d|vvs|vs)$/i.test(value)) return value.toUpperCase();
  return value.charAt(0).toUpperCase() + value.slice(1);
}
