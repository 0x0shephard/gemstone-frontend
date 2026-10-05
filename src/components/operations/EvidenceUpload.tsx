import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
  uploadRedemptionEvidence,
  type EvidenceCategory,
  type WorkflowEvidenceView,
} from '@/services/offchain/operations';

export function EvidenceUpload({
  requestId,
  organizationId,
  category,
  label,
  onUploaded,
}: {
  requestId: string;
  organizationId?: string;
  category: EvidenceCategory;
  label: string;
  onUploaded: (evidence: WorkflowEvidenceView) => void;
}) {
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      const evidence = await uploadRedemptionEvidence({
        requestId,
        organizationId,
        category,
        file,
      });
      onUploaded(evidence);
      setFile(undefined);
      if (inputRef.current) inputRef.current.value = '';
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Evidence could not be uploaded.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-[4px] border border-line/[0.08] p-3">
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          {label}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={(event) => setFile(event.target.files?.[0])}
          className="block w-full text-[12px] text-ink-muted file:mr-3 file:rounded-[4px] file:border file:border-line/[0.1] file:bg-line/[0.04] file:px-3 file:py-2 file:text-[11.5px] file:font-semibold file:text-ink"
        />
      </label>
      <p className="text-[10.5px] leading-relaxed text-ink-dim">
        PDF, JPEG, PNG or WebP, up to 20 MB. The file is hashed locally and verified after upload.
      </p>
      {error && (
        <p role="alert" className="text-[11.5px] text-ruby">
          {error}
        </p>
      )}
      <Button type="button" size="sm" variant="secondary" disabled={!file || busy} onClick={upload}>
        {busy ? 'Uploading and verifying…' : 'Upload evidence'}
      </Button>
    </div>
  );
}
