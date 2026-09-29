import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAddressEqual, zeroAddress, zeroHash, type Address } from 'viem';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { CardGridSkeleton, EmptyState } from '@/components/ui/States';
import { TxButton } from '@/components/tx/TxButton';
import { explorerTxUrl } from '@/config/chains';
import { giftOperatorAddress } from '@/config/contracts';
import { shortenAddress } from '@/lib/format';
import { dataService } from '@/services';
import { useAuth } from '@/providers/AuthProvider';
import {
  cancelGiftCard,
  confirmGiftCardEscrow,
  giftCardState,
  listGiftCards,
  resumeGiftCard,
  type GiftCardRow,
  type GiftCardState,
} from '@/services/offchain/gift';
import type { DecoratedGem } from '@/services/types';
import {
  clearGiftHandoff,
  listGiftHandoffs,
  saveGiftHandoff,
} from '@/services/offchain/giftHandoff';
import { env } from '@/config/env';
import { useGem } from '@/hooks/useData';
import { GiftCardComposer } from './GiftCardComposer';

const TONE: Record<GiftCardState, 'success' | 'warning' | 'neutral'> = {
  pending: 'warning',
  active: 'success',
  claiming: 'warning',
  claimed: 'success',
  cancelling: 'warning',
  cancelled: 'neutral',
  expired: 'warning',
};

const LABEL: Record<GiftCardState, string> = {
  pending: 'Waiting for escrow',
  active: 'Awaiting claim',
  claiming: 'Claim transfer pending',
  claimed: 'Claimed',
  cancelling: 'Return transfer pending',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

/**
 * The sender's own cards.
 *
 * New cards are held in operator escrow and cancellation returns the token.
 * Approval reconciliation remains only for cards created before that migration.
 */
export function GiftCardList({ owned }: { owned: DecoratedGem[] }) {
  const queryClient = useQueryClient();
  const { user, linkedWallet } = useAuth();
  const [error, setError] = useState<string | null>(null);

  // Keyed by account. These rows carry recipient names, email addresses and
  // personal messages, and a key that does not name the account is shared by
  // every account that uses this tab. Sign-out clears the cache as well; this is
  // the half that also holds within a session.
  const {
    data: allCards,
    isLoading,
    isError: cardsFailed,
    error: cardsError,
    refetch: retryCards,
  } = useQuery({
    queryKey: ['giftCards', user?.id ?? 'anonymous'],
    queryFn: listGiftCards,
    enabled: Boolean(user),
  });

  /*
   * Cards still worth showing.
   *
   * The list rendered every card ever issued, so one cancelled months ago sat
   * beside a live one for good. Cancelling is the act of finishing with a card;
   * a claimed one is finished too, and its stone has moved on to somebody else's
   * portfolio. Neither leaves anything to do.
   *
   * `cards` still drives the approval reconciliation below, which needs the
   * cancelled ones: a card withdrawn without its on-chain approval being revoked
   * is precisely what the stranded-approvals panel exists to catch.
   */
  const cards = (allCards ?? []).filter(
    (card) =>
      card.status === 'pending_escrow' ||
      card.status === 'active' ||
      card.status === 'claim_pending' ||
      card.status === 'cancel_pending',
  );
  const recoveries = linkedWallet
    ? listGiftHandoffs({ chainId: env.chainId, account: linkedWallet })
    : [];

  /*
   * Every owned token, not only the ones with a card.
   *
   * Legacy cards approved the operator before writing their record. Keeping all
   * owned token ids in this check surfaces any approval stranded by that older
   * flow; escrow cards themselves do not create approvals.
   */
  const tokenIds = [
    ...new Set([
      ...(allCards ?? []).map((card) => card.token_id),
      ...owned.filter((gem) => gem.tokenId !== undefined).map((gem) => String(gem.tokenId)),
    ]),
  ];
  const {
    data: approvals,
    isError: approvalsFailed,
    refetch: retryApprovals,
  } = useQuery({
    queryKey: ['giftCardApprovals', tokenIds.join(',')],
    queryFn: () => dataService.getTokenApprovals(tokenIds.map((id) => BigInt(id))),
    enabled: tokenIds.length > 0,
  });

  const operator = giftOperatorAddress;
  // Approved to the gift operator, with no card explaining why.
  const strandedApprovals = operator
    ? tokenIds.filter((tokenId) => {
        const approved = approvals?.[tokenId];
        if (!approved || isAddressEqual(approved, zeroAddress)) return false;
        if (!isAddressEqual(approved, operator)) return false;
        return !(allCards ?? []).some(
          (card) => card.token_id === tokenId && card.status === 'active',
        );
      })
    : [];

  const cancel = useMutation({
    mutationFn: cancelGiftCard,
    // An escrow cancellation changes both the private card row and chain-owned
    // portfolio, so refresh both rather than only the gift list.
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (cancelError: unknown) =>
      setError(cancelError instanceof Error ? cancelError.message : 'Could not cancel the card'),
  });

  if (isLoading && !allCards) return <CardGridSkeleton count={2} />;
  if (cardsFailed && !allCards) {
    return (
      <EmptyState
        title="Gift cards could not be loaded"
        hint={cardsError instanceof Error ? cardsError.message : 'Try the request again.'}
        action={<Button onClick={() => void retryCards()}>Retry</Button>}
      />
    );
  }
  // An empty state is only honest when there is genuinely nothing outstanding.
  // A stranded approval is outstanding whether or not a card exists.
  if (!cardsFailed && !approvalsFailed && cards.length === 0 && strandedApprovals.length === 0) {
    return (
      <EmptyState
        title="No gift cards"
        hint="Send a token as a gift card from Owned Tokens and it will appear here."
      />
    );
  }

  return (
    <div className="space-y-3">
      {cardsFailed && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-[4px] border border-amber/25 bg-amber/[0.07] px-3 py-2 text-[12px] text-amber"
        >
          <span>Refresh failed. Showing the last gift-card list.</span>
          <Button size="sm" variant="ghost" onClick={() => void retryCards()}>
            Retry
          </Button>
        </div>
      )}
      {approvalsFailed && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-[4px] border border-amber/25 bg-amber/[0.07] px-3 py-2 text-[12px] text-amber"
        >
          <span>Token permissions could not be refreshed. Gift cards are still shown.</span>
          <Button size="sm" variant="ghost" onClick={() => void retryApprovals()}>
            Retry
          </Button>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-[4px] border border-ruby/25 bg-ruby/[0.07] px-3 py-2 text-[12.5px] text-ruby"
        >
          {error}
        </p>
      )}
      {strandedApprovals.length > 0 && (
        <Card className="p-4">
          <h3 className="text-[13px] font-semibold text-ink">Permissions left behind</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
            {strandedApprovals.length === 1 ? 'A token is' : 'These tokens are'} still approved for
            the gift operator with no active card. That usually means an issue was interrupted part
            way. Nobody can spend it without a card, but only you can withdraw the permission.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {strandedApprovals.map((tokenId) => (
              <TxButton
                key={tokenId}
                size="sm"
                variant="secondary"
                action={() => dataService.revokeApproval({ tokenId: BigInt(tokenId) })}
                pendingLabel="Revoking…"
                telemetryFlow="gift_revoke_orphan_approval"
                onDone={() => queryClient.invalidateQueries({ queryKey: ['giftCardApprovals'] })}
                doneLabel="Done"
              >
                Revoke token #{tokenId}
              </TxButton>
            ))}
          </div>
        </Card>
      )}
      {cards.map((card) => (
        <GiftCardRowItem
          key={card.id}
          card={card}
          recovery={recoveries.find((handoff) => handoff.card.giftId === card.id)}
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
  recovery,
  gem,
  approvedTo,
  onCancel,
  cancelling,
}: {
  card: GiftCardRow;
  recovery?: ReturnType<typeof listGiftHandoffs>[number];
  gem?: DecoratedGem;
  approvedTo?: Address;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const queryClient = useQueryClient();
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const activation = useMutation({
    mutationFn: async () => {
      if (!recovery) throw new Error('The recovery code is no longer available in this tab.');
      return confirmGiftCardEscrow(recovery.card, recovery.escrowTxHash ?? zeroHash);
    },
    onSuccess: () => {
      if (recovery) {
        clearGiftHandoff({
          chainId: recovery.chainId,
          account: recovery.account,
          giftId: recovery.card.giftId,
        });
      }
      void queryClient.invalidateQueries({ queryKey: ['giftCards'] });
    },
    onError: (activationError: unknown) =>
      setRecoveryError(
        activationError instanceof Error
          ? activationError.message
          : 'Could not confirm the gift escrow.',
      ),
  });
  const { linkedWallet } = useAuth();
  const [resumeOpen, setResumeOpen] = useState(false);
  const resume = useMutation({
    mutationFn: () => resumeGiftCard(card.id),
    onSuccess: (resumed) => {
      if (!linkedWallet || !card.gem_id) return;
      // The composer restores from this record on mount: straight to activation
      // when custody is already proven, otherwise to the transfer step.
      saveGiftHandoff({
        chainId: env.chainId,
        account: linkedWallet,
        gemId: card.gem_id,
        card: resumed,
        recipientEmail: card.recipient_email,
        recipientName: card.recipient_name ?? '',
        message: card.message ?? '',
        template: card.template,
        awaitingTransfer: resumed.custody === 'sender',
      });
      setResumeOpen(true);
    },
    onError: (resumeError: unknown) =>
      setRecoveryError(
        resumeError instanceof Error ? resumeError.message : 'Could not resume the gift card.',
      ),
  });
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
    card.custody_mode === 'approval' &&
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
        {state === 'pending' && <span>Prepared, but not yet confirmed in escrow</span>}
        {state === 'active' && (
          <span>
            {card.custody_mode === 'operator_escrow' ? 'Held in escrow · ' : ''}Claimable until{' '}
            {expires.toLocaleDateString()}
          </span>
        )}
        {state === 'claiming' && <span>Claim submitted; checking chain confirmation</span>}
        {state === 'cancelling' && <span>Return submitted; checking chain confirmation</span>}
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

      {recoveryError && (
        <p role="alert" className="text-[11.5px] text-ruby">
          {recoveryError}
        </p>
      )}

      {card.status === 'pending_escrow' && recovery && (
        <div className="rounded-[4px] border border-amber/25 bg-amber/[0.06] p-3">
          <p className="text-[11.5px] leading-relaxed text-ink-muted">
            This card has a saved recovery code. Confirm escrow without transferring the token
            again.
          </p>
          <Button
            className="mt-2"
            size="sm"
            variant="secondary"
            disabled={activation.isPending}
            onClick={() => {
              setRecoveryError(null);
              activation.mutate();
            }}
          >
            {activation.isPending ? 'Checking escrow…' : 'Resume gift activation'}
          </Button>
        </div>
      )}

      {card.status === 'pending_escrow' && !recovery && card.gem_id && linkedWallet && (
        <div className="rounded-[4px] border border-amber/25 bg-amber/[0.06] p-3">
          <p className="text-[11.5px] leading-relaxed text-ink-muted">
            This setup was interrupted before the card was issued. Finishing it here issues a new
            claim code, and needs no second transfer if the token is already in escrow.
          </p>
          <Button
            className="mt-2"
            size="sm"
            variant="secondary"
            disabled={resume.isPending}
            onClick={() => {
              setRecoveryError(null);
              resume.mutate();
            }}
          >
            {resume.isPending ? 'Resuming…' : 'Finish gift card'}
          </Button>
        </div>
      )}

      {resumeOpen && card.gem_id && (
        <ResumedComposer
          gemId={card.gem_id}
          onClose={() => {
            setResumeOpen(false);
            void queryClient.invalidateQueries();
          }}
          onUnavailable={() => {
            setResumeOpen(false);
            setRecoveryError('The gemstone could not be loaded. Try Finish gift card again.');
          }}
        />
      )}

      {canRevoke && (
        <div className="rounded-[4px] border border-amber/25 bg-amber/[0.06] p-3">
          <p className="text-[11.5px] leading-relaxed text-ink-muted">
            This card can no longer be claimed, but the approval you granted is still on the token.
            Digital Carat will not act on it — clearing it yourself is how you stop being able to
            take our word for that.
          </p>
        </div>
      )}

      {(card.status === 'pending_escrow' || card.status === 'active' || canRevoke) && (
        <div className="flex flex-wrap gap-2">
          {(card.status === 'pending_escrow' || card.status === 'active') && (
            <Button size="sm" variant="ghost" disabled={cancelling} onClick={onCancel}>
              {cancelling
                ? 'Cancelling…'
                : card.status === 'pending_escrow'
                  ? 'Cancel setup'
                  : card.custody_mode === 'operator_escrow'
                    ? 'Cancel and return token'
                    : 'Cancel card'}
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

/**
 * The composer for a resumed card. The token may already sit in escrow, so the
 * gem is loaded by id rather than taken from the sender's current holdings.
 */
function ResumedComposer({
  gemId,
  onClose,
  onUnavailable,
}: {
  gemId: string;
  onClose: () => void;
  onUnavailable: () => void;
}) {
  const { data: gem, isLoading, isError } = useGem(gemId);
  const unavailable = isError || (!isLoading && !gem);
  useEffect(() => {
    if (unavailable) onUnavailable();
  }, [onUnavailable, unavailable]);
  if (!gem) return null;
  return <GiftCardComposer gem={gem} open onClose={onClose} onBack={onClose} />;
}
