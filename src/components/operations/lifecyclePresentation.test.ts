import { describe, expect, it } from 'vitest';
import { sellerLifecycleStages } from './lifecyclePresentation';

describe('seller lifecycle presentation', () => {
  it('does not infer green bank or listing stages from a legacy terminal label', () => {
    const stages = sellerLifecycleStages({
      workflowId: 'workflow',
      submissionId: 'submission',
      state: 'listed',
      version: 0,
      legacyBaseline: true,
      updatedAt: '2026-10-03T00:00:00.000Z',
      events: [],
      nextActions: [],
    });

    expect(stages.find((stage) => stage.key === 'bank_received')?.state).toBe('pending');
    expect(stages.find((stage) => stage.key === 'registered')?.state).toBe('pending');
    expect(stages.find((stage) => stage.key === 'safe_wagon_islamabad')?.state).toBe('pending');
    expect(stages.find((stage) => stage.key === 'turkish_airlines')?.state).toBe('pending');
    expect(stages.find((stage) => stage.key === 'listed')).toMatchObject({
      state: 'current',
      detail: 'Legacy baseline. No post-migration evidence event is asserted.',
    });
  });

  it('marks bank receipt complete only when an explicit event exists', () => {
    const stages = sellerLifecycleStages({
      workflowId: 'workflow',
      submissionId: 'submission',
      state: 'activation_started',
      version: 3,
      legacyBaseline: false,
      updatedAt: '2026-10-03T00:00:00.000Z',
      events: [
        {
          id: 'bank-event',
          sequence: 2,
          type: 'bank_receipt_recorded',
          fromState: 'appraised',
          toState: 'bank_received',
          occurredAt: '2026-10-03T00:00:00.000Z',
          payload: {},
        },
      ],
      nextActions: [],
    });

    expect(stages.find((stage) => stage.key === 'bank_received')?.state).toBe('complete');
    for (const key of [
      'safe_wagon_islamabad',
      'turkish_airlines',
      'turkish_house',
      'safe_wagon_turkey',
    ]) {
      expect(stages.find((stage) => stage.key === key)).toMatchObject({
        state: 'complete',
        occurredAt: '2026-10-03T00:00:00.000Z',
        detail: 'Confirmed retroactively by the authoritative final storage-bank receipt.',
      });
    }
  });

  it('keeps physical handoff stages pending before the final bank receipt', () => {
    const stages = sellerLifecycleStages({
      workflowId: 'workflow',
      submissionId: 'submission',
      state: 'appraised',
      version: 1,
      legacyBaseline: false,
      updatedAt: '2026-10-03T00:00:00.000Z',
      events: [
        {
          id: 'appraisal',
          sequence: 1,
          type: 'gem_appraised',
          fromState: 'submitted',
          toState: 'appraised',
          occurredAt: '2026-10-03T00:00:00.000Z',
          payload: {},
        },
      ],
      nextActions: [],
    });

    expect(
      stages
        .filter((stage) =>
          [
            'safe_wagon_islamabad',
            'turkish_airlines',
            'turkish_house',
            'safe_wagon_turkey',
          ].includes(stage.key),
        )
        .every((stage) => stage.state === 'pending'),
    ).toBe(true);
  });
});
