import type { KycStatus as KycState } from '@/hooks/useKyc';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';

const MAP: Record<KycState, { tone: StatusTone; label: string }> = {
  not_started: { tone: 'neutral', label: 'KYC not started' },
  pending: { tone: 'warning', label: 'KYC in review' },
  approved: { tone: 'success', label: 'KYC verified' },
  rejected: { tone: 'danger', label: 'KYC rejected' },
  on_hold: { tone: 'warning', label: 'KYC on hold' },
};

/** Seller KYC status pill. */
export function KycStatus({ status }: { status: KycState }) {
  const { tone, label } = MAP[status];
  return (
    <StatusBadge tone={tone} dot>
      {label}
    </StatusBadge>
  );
}
