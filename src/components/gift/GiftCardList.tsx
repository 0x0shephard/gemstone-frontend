import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAddressEqual, zeroAddress, type Address } from 'viem';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { CardGridSkeleton, EmptyState } from '@/components/ui/States';
import { TxButton } from '@/components/tx/TxButton';
import { explorerTxUrl } from '@/config/chains';
import { giftOperatorAddress } from '@/config/contracts';
import { shortenAddress } from '@/lib/format';
import { dataService } from '@/services';
import {
  cancelGiftCard,
  giftCardState,
  listGiftCards,
  type GiftCardRow,
  type GiftCardState,
} from '@/services/offchain/gift';
import type { DecoratedGem } from '@/services/types';

const TONE: Record<GiftCardState, 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  claimed: 'success',
  cancelled: 'neutral',
  expired: 'warning',
};

const LABEL: Record<GiftCardState, string> = {
  active: 'Awaiting claim',
  claimed: 'Claimed',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

/**
 * The sender's own cards.
 *
 * Its real job is the second half of each row: a card that is no longer
 * claimable can still leave a live approval on the token, because ERC-721
 * `approve` may only be called by the owner and the operator therefore cannot
 * withdraw its own permission. Nothing else in the app would ever tell the
 * owner that permission is still outstanding.
 */
export function GiftCardList({ owned }: { owned: DecoratedGem[] }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: cards, isLoading } = useQuery({
    queryKey: ['giftCards'],
    queryFn: listGiftCards,
  });

  const tokenIds = (cards ?? []).map((card) => card.token_id);
  const { data: approvals } = useQuery({
    queryKey: ['giftCardApprovals', tokenIds.join(',')],
    queryFn: () => dataService.getTokenApprovals(tokenIds.map((id) => BigInt(id))),
    enabled: tokenIds.length > 0,
  });

  const cancel = useMutation({
    mutationFn: cancelGiftCard,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['giftCards'] }),
    onError: (cancelError: unknown) =>
      setError(cancelError instanceof Error ? cancelError.message : 'Could not cancel the card'),
  });

  if (isLoading) return <CardGridSkeleton count={2} />;
  if (!cards?.length) {
    return (
      <EmptyState
        title="No gift cards"
        hint="Send a token as a gift card from Owned Tokens and it will appear here."
      />
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p
          role="alert"
          className="rounded-[4px] border border-ruby/25 bg-ruby/[0.07] px-3 py-2 text-[12.5px] text-ruby"
        >
          {error}
        </p>
      )}
      {cards.map((card) => (
        <GiftCardRowItem
          key={card.id}
          card={card}
          gem={owned.find((gem) => gem.tokenId?.toString() === card.token_id)}
          approvedTo={approvals?.[card.token_id]}
          onCancel={() => {
            setError(null);
            cancel.mutate(card.id);
          }}
          cancelling={cancel.isPending && cancel.variables === card.id}
        />
      ))}
    </div>
  );
}

function GiftCardRowItem({
  card,
  gem,
  approvedTo,
  onCancel,
  cancelling,
}: {
  card: GiftCardRow;
  gem?: DecoratedGem;
  approvedTo?: Address;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const queryClient = useQueryClient();
  const state = giftCardState(card);

  /*
   * Only worth offering when it is both outstanding and pointless — a live
   * approval on a card nobody can claim any more. While a card is active the
   * approval is the mechanism, and revoking it would quietly break the claim
   * without cancelling the card.
   */
  const approvalOutstanding = Boolean(
    giftOperatorAddress &&
    approvedTo &&
    !isAddressEqual(approvedTo, zeroAddress) &&
    isAddressEqual(approvedTo, giftOperatorAddress),
  );
  const canRevoke = approvalOutstanding && state !== 'active';

  const expires = new Date(card.expires_at);

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-ink">
            {gem?.name ?? `Token #${card.token_id}`}
          </div>
          <div className="mt-0.5 text-[12px] text-ink-muted">
            To {card.recipient_name ? `${card.recipient_name} · ` : ''}
            <span className="font-mono">{card.recipient_email}</span>
          </div>
        </div>
        <StatusBadge tone={TONE[state]} dot={state === 'active'}>
          {LABEL[state]}
        </StatusBadge>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-dim">
        {state === 'active' && <span>Claimable until {expires.toLocaleDateString()}</span>}
        {state === 'claimed' && card.claimed_wallet && (
          <span className="font-mono">
            Sent to {shortenAddress(card.claimed_wallet as Address)}
          </span>
        )}
        {card.claim_tx_hash && (
          <a
            href={explorerTxUrl(card.claim_tx_hash)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-emerald hover:underline"
          >
            {shortenAddress(card.claim_tx_hash, 6)} ↗
          </a>
        )}
      </div>

      {canRevoke && (
        <div className="rounded-[4px] border border-amber/25 bg-amber/[0.06] p-3">
          <p className="text-[11.5px] leading-relaxed text-ink-muted">
            This card can no longer be claimed, but the approval you granted is still on the token.
            Digital Carat will not act on it — clearing it yourself is how you stop being able to
            take our word for that.
          </p>
        </div>
      )}

      {(state === 'active' || canRevoke) && (
        <div className="flex flex-wrap gap-2">
          {state === 'active' && (
            <Button size="sm" variant="ghost" disabled={cancelling} onClick={onCancel}>
              {cancelling ? 'Cancelling…' : 'Cancel card'}
            </Button>
          )}
          {canRevoke && (
            <TxButton
              size="sm"
              variant="secondary"
              action={() => dataService.revokeApproval({ tokenId: BigInt(card.token_id) })}
              pendingLabel="Revoking…"
              telemetryFlow="gift_revoke_approval"
              onDone={() => queryClient.invalidateQueries({ queryKey: ['giftCardApprovals'] })}
              doneLabel="Done"
            >
              Revoke approval
            </TxButton>
          )}
        </div>
      )}
    </Card>
  );
}
