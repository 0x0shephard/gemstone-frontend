import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LifecycleTracker } from './LifecycleTracker';

describe('LifecycleTracker', () => {
  it('keeps corrected audit records visible beside their replacement', () => {
    render(
      <LifecycleTracker
        stages={[
          { key: 'request', label: 'Requested', state: 'complete' },
          { key: 'arrival', label: 'Bank arrival', state: 'current' },
        ]}
        events={[
          {
            id: 'event-old',
            label: 'Storage location recorded',
            occurredAt: '2026-10-03T08:00:00.000Z',
            supersededBy: 'event-new',
          },
          {
            id: 'event-new',
            label: 'Storage location corrected',
            occurredAt: '2026-10-03T08:10:00.000Z',
            correctionOf: 'event-old',
          },
        ]}
      />,
    );

    expect(screen.getByText('Storage location recorded')).toBeVisible();
    expect(screen.getByText('Storage location corrected')).toBeVisible();
    expect(screen.getByText('Superseded by event-new')).toBeVisible();
    expect(screen.getByText('Corrects event-old')).toBeVisible();
  });

  it('shows the real empty audit state instead of inferred events', () => {
    render(
      <LifecycleTracker
        stages={[{ key: 'request', label: 'Requested', state: 'pending' }]}
        events={[]}
      />,
    );

    expect(screen.getByText('No lifecycle events have been recorded yet.')).toBeVisible();
  });
});
