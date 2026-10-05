import { describe, expect, it } from 'vitest';
import { sameAppraisalIntent } from './appraisalIntent';

describe('appraisal intent retry binding', () => {
  const persisted = {
    organization_id: 'lab-1',
    appraised_by: 'grader-1',
    primary_image_evidence_id: 'image-1',
    graded_inputs: { clarity: 'vvs', nested: { b: 2, a: 1 } },
  };

  it('accepts the same caller-controlled intent despite JSONB key reordering', () => {
    expect(
      sameAppraisalIntent(persisted, {
        organizationId: 'lab-1',
        appraisedBy: 'grader-1',
        primaryImageId: 'image-1',
        gradedInputs: { nested: { a: 1, b: 2 }, clarity: 'vvs' },
      }),
    ).toBe(true);
  });

  it.each([
    ['organizationId', 'lab-2'],
    ['appraisedBy', 'grader-2'],
    ['primaryImageId', 'image-2'],
  ] as const)('rejects a changed %s', (field, value) => {
    expect(
      sameAppraisalIntent(persisted, {
        organizationId: 'lab-1',
        appraisedBy: 'grader-1',
        primaryImageId: 'image-1',
        gradedInputs: persisted.graded_inputs,
        [field]: value,
      }),
    ).toBe(false);
  });

  it('rejects changed grading input', () => {
    expect(
      sameAppraisalIntent(persisted, {
        organizationId: 'lab-1',
        appraisedBy: 'grader-1',
        primaryImageId: 'image-1',
        gradedInputs: { clarity: 'vs', nested: { a: 1, b: 2 } },
      }),
    ).toBe(false);
  });
});
