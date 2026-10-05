import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EvidenceUpload } from './EvidenceUpload';

vi.mock('@/services/offchain/operations', () => ({
  uploadRedemptionEvidence: vi.fn(async () => ({
    id: 'evidence-1',
    category: 'courier_delivery',
    mimeType: 'image/png',
    byteSize: 4,
    sha256: 'a'.repeat(64),
    state: 'verified',
  })),
}));

describe('EvidenceUpload', () => {
  it('reports completion only after the upload service returns verified evidence', async () => {
    const onUploaded = vi.fn();
    render(
      <EvidenceUpload
        requestId="request-1"
        category="courier_delivery"
        label="Delivery proof"
        onUploaded={onUploaded}
      />,
    );
    const file = new File(['proof'], 'proof.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Delivery proof'), file);
    expect(onUploaded).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Upload evidence' }));
    expect(onUploaded).toHaveBeenCalledWith(expect.objectContaining({ state: 'verified' }));
  });

  it('does not submit a containing workflow form when evidence is uploaded', async () => {
    const onUploaded = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <EvidenceUpload
          requestId="request-1"
          category="custodian_collection"
          label="Collection evidence"
          onUploaded={onUploaded}
        />
      </form>,
    );

    await userEvent.upload(
      screen.getByLabelText('Collection evidence'),
      new File(['proof'], 'collection.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Upload evidence' }));

    expect(onUploaded).toHaveBeenCalledWith(expect.objectContaining({ state: 'verified' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
