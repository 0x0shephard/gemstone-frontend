import { useParams, Link } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useAuctions, useBidPolicy, useBidSummaries, useGem, useSwaps } from '@/hooks/useData';
import { WinningBid } from '@/components/gem/WinningBid';
import { GemThumb } from '@/components/gem/GemThumb';
import { StatTile } from '@/components/ui/StatTile';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ReserveStatus } from '@/components/gem/ReserveStatus';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Skeleton, ErrorState } from '@/components/ui/States';
import { GemActionModals } from '@/components/modals/GemActionModals';
import { useGemModals } from '@/hooks/useGemModals';
import { PriceBreakdown } from '@/components/gem/PriceBreakdown';
import { ProvenanceChain } from '@/components/gem/ProvenanceChain';
import { TxButton } from '@/components/tx/TxButton';
import { dataService } from '@/services';
import { gemLocation } from '@/lib/gem';
import { contractAddresses, giftOperatorAddress } from '@/config/contracts';
import { activeChain } from '@/config/chains';
import { openSeaItemUrl } from '@/lib/externalMarketplaces';
import { gemPageMode } from '@/lib/gemActions';
import { EmptyState } from '@/components/ui/States';

export default function GemDetailPage() {
  const { gemId = '' } = useParams();
  const { data: gem, isLoading, isError } = useGem(gemId);
  const { address } = useAccount();
  const modals = useGemModals();
  const bids = useBidSummaries();
  const { data: auctions, isLoading: auctionsLoading } = useAuctions();
  const { data: swaps } = useSwaps();
  const { data: policy } = useBidPolicy();

  if (isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-[460px]" />
        <Skeleton className="h-[460px]" />
      </div>
    );
  }
  if (isError) return <ErrorState message="This gemstone could not be loaded." />;
  if (!gem) {
    return (
      <div className="space-y-4">
        <EmptyState
          title="Gemstone not found"
          hint="This address does not match a registered gemstone. It may have been redeemed, or the link is mistyped."
        />
        <div className="text-center">
          <Link
            to="/marketplace"
            className="text-[13px] font-semibold text-atelier underline-offset-2 hover:underline"
          >
            ← Back to the vault inventory
          </Link>
        </div>
      </div>
    );
  }
  const winning = gem.tokenId ? bids.get(gem.tokenId.toString()) : undefined;

  /*
   * Read from the chain, never from the URL. Owner actions need actual
   * ownership: `?manage=1` used to switch them on for whoever followed the
   * link, offering List and Send on someone else's token. A token escrowed in
   * the viewer's own swap gets that swap's cancel instead, since List and Send
   * cannot move a token SwapEscrow holds. Bids are offered only while an
   * auction is actually open; an ended one offers settlement.
   */
  const custody = {
    marketplace: contractAddresses.Marketplace,
    swapEscrow: contractAddresses.SwapEscrow,
    giftOperator: giftOperatorAddress,
  };
  const mode = gemPageMode(gem, {
    viewer: address,
    auction: auctions?.find((candidate) => candidate.gem.gemId === gem.gemId),
    auctionsLoading,
    swaps,
    custody,
  });
  const isManageView =
    mode.kind === 'owner-wallet' ||
    mode.kind === 'owner-listing' ||
    mode.kind === 'owner-swap-escrow' ||
    (mode.kind === 'locked' && mode.owner);
  const primaryPaused = policy?.primary.paused === true;
  const listingPaused = policy?.listing.paused === true;
  const settleListingButton = (
    <div className="col-span-2">
      <TxButton
        block
        disabled={!gem.tokenId || listingPaused}
        action={() => dataService.settleListingAuction({ tokenId: gem.tokenId! })}
        pendingLabel="Settling…"
        telemetryFlow="listed_token_auction_settle"
      >
        {listingPaused ? 'Settlement paused' : 'Settle auction'}
      </TxButton>
    </div>
  );
  const openSeaUrl =
    gem.tokenId && contractAddresses.DGENFT
      ? openSeaItemUrl(activeChain.id, contractAddresses.DGENFT, gem.tokenId)
      : undefined;

  const specs: [string, React.ReactNode][] = [
    ['Gem ID', <span className="font-mono">{gem.displayId}</span>],
    ['Type', gem.typeLabel],
    ['Carat', gem.caratsFmt],
    ['Custody', gem.custodyLabel],
    ...(gem.custodyAgreementEndsAt
      ? ([
          [
            'Custody agreement ends',
            `${new Date(gem.custodyAgreementEndsAt).toLocaleDateString()}${
              gem.custodyAgreementAmended ? ' · extended' : ''
            }`,
          ],
        ] as [string, React.ReactNode][])
      : []),
    ['Market fee', gem.feeLabel],
    ['Redemption', gem.redeem],
    ...(openSeaUrl
      ? ([
          [
            'Also on',
            <a
              href={openSeaUrl}
              target="_blank"
              rel="noreferrer"
              className="text-emerald hover:underline"
            >
              OpenSea ↗
            </a>,
          ],
        ] as [string, React.ReactNode][])
      : []),
  ];

  return (
    <div className="space-y-6">
      <Link
        to="/marketplace"
        className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted hover:text-ink"
      >
        <span aria-hidden>←</span> Vault inventory
      </Link>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_.95fr]">
        {/* Left: visual + stats */}
        <div className="space-y-4">
          <div className="dc-facet-border overflow-hidden rounded-[4px] border border-line/[0.09] bg-card">
            <GemThumb gem={gem} height={440} rounded="rounded-[4px]" showTag showCarat />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Carat" value={gem.carats.toFixed(2)} />
            <StatTile
              label="Custodian"
              value={<span className="text-[15px]">{gem.custodyProvider}</span>}
            />
            <StatTile label="Secondary fee" value={`${gem.feePct.toFixed(1)}%`} />
          </div>
        </div>

        {/* Right: pricing + actions */}
        <div className="space-y-5">
          <div className="pt-1">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusBadge color={gem.color}>{gem.typeLabel}</StatusBadge>
              {gem.funded ? (
                <StatusBadge tone="success" dot>
                  Funded
                </StatusBadge>
              ) : (
                <StatusBadge tone="warning" dot>
                  Reserve short
                </StatusBadge>
              )}
              {gem.redeem === 'Blocked' && (
                <StatusBadge tone="danger">Redemption blocked</StatusBadge>
              )}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.13em] text-ink-dim">
              {gem.displayId}
            </div>
            <h1 className="mt-2 font-display text-[30px] font-medium leading-tight tracking-[-0.04em] text-ink sm:text-[36px]">
              {gem.name}
            </h1>
            {(() => {
              const location = gemLocation(gem, address, custody);
              return (
                <div className="mt-2">
                  <StatusBadge tone={location.tone} dot>
                    {location.label}
                  </StatusBadge>
                </div>
              );
            })()}
          </div>

          <Card className="dc-facet-border p-5 sm:p-6">
            <PriceBreakdown gem={gem} />
            {winning && (
              <div className="mt-5">
                <WinningBid summary={winning} />
              </div>
            )}
            <div className="mt-5 border-t border-line/[0.06] pt-5">
              <ReserveStatus gem={gem} showShortfall={false} />
            </div>

            <div className="mt-5 border-t border-line/[0.06] pt-5">
              <div className="mb-3 text-[9.5px] font-semibold uppercase tracking-[0.15em] text-ink-dim">
                {isManageView ? 'Ownership actions' : 'Available actions'}
              </div>
              {mode.kind === 'locked' ? (
                /*
                 * RedemptionManager has locked the token. Every transfer reverts
                 * until the redemption is cancelled or the token is burned, so
                 * listing, swapping, sending and offers are all unavailable.
                 */
                <div className="space-y-3">
                  <p className="text-[11.5px] leading-relaxed text-ink-dim">
                    This gemstone is being redeemed for physical delivery. It cannot be listed,
                    swapped, sent or bid on while the redemption is open.
                  </p>
                  {mode.owner && (
                    <Link to="/redeem" className="block">
                      <Button variant="secondary" block>
                        Track redemption
                      </Button>
                    </Link>
                  )}
                </div>
              ) : mode.kind === 'owner-listing' ? (
                <div className="grid grid-cols-2 gap-2.5">
                  {mode.listingAuction === 'ended' ? (
                    <>
                      <p className="col-span-2 text-[11.5px] leading-relaxed text-ink-dim">
                        The auction on your listing has ended. Settling it sends the winning payment
                        to you and the token to the winner; anyone can do it.
                      </p>
                      {settleListingButton}
                    </>
                  ) : mode.listingAuction === 'live' ? (
                    /*
                     * Marketplace.cancel reverts AuctionActive once a qualifying
                     * bid leads: the bidder's funds are committed and the
                     * auction settles to them at expiry.
                     */
                    <p className="col-span-2 text-[11.5px] leading-relaxed text-ink-dim">
                      A bid is live on this listing, so it can no longer be cancelled. When its
                      timer ends the auction can be settled to the winning bid.
                    </p>
                  ) : (
                    <>
                      <p className="col-span-2 text-[11.5px] leading-relaxed text-ink-dim">
                        This NFT is escrowed by the Marketplace. Cancel the listing before swapping,
                        redeeming, or accepting an offer.
                      </p>
                      <TxButton
                        block
                        variant="secondary"
                        disabled={!gem.tokenId}
                        action={() => dataService.cancelListing({ tokenId: gem.tokenId! })}
                        pendingLabel="Cancelling…"
                        telemetryFlow="cancel_listing"
                      >
                        Cancel listing
                      </TxButton>
                    </>
                  )}
                </div>
              ) : mode.kind === 'owner-swap-escrow' ? (
                <div className="space-y-3">
                  <p className="text-[11.5px] leading-relaxed text-ink-dim">
                    {mode.swap?.status === 'Expired'
                      ? 'Your swap offer for this gemstone has expired, but the swap escrow still holds it. Cancel the swap to return it to your wallet.'
                      : 'This gemstone is held by the swap escrow for a swap you proposed. It cannot be listed or sent until the swap is accepted or you cancel it.'}
                  </p>
                  {mode.swap && (
                    <TxButton
                      block
                      variant="secondary"
                      action={() => dataService.cancelSwap({ offerId: mode.swap!.offerId })}
                      pendingLabel="Cancelling…"
                      telemetryFlow="swap_cancel"
                    >
                      {mode.swap.status === 'Expired' ? 'Return my gemstone' : 'Cancel swap'}
                    </TxButton>
                  )}
                  <Link to="/swaps" className="block">
                    <Button variant="ghost" block>
                      View my swaps
                    </Button>
                  </Link>
                </div>
              ) : mode.kind === 'owner-wallet' ? (
                <div className="grid grid-cols-2 gap-2.5">
                  <Button onClick={() => modals.open('list', gem)} disabled={!gem.tokenId}>
                    List for sale
                  </Button>
                  <Button variant="secondary" onClick={() => modals.open('swap', gem)}>
                    Propose swap
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => modals.open('send', gem)}
                    disabled={!gem.tokenId}
                  >
                    Send token
                  </Button>
                  {!gem.funded && (
                    <Button variant="secondary" onClick={() => modals.open('reserve', gem)}>
                      Fund reserve
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="col-span-2"
                    onClick={() => modals.open('redeem', gem)}
                  >
                    Redeem physical gemstone
                  </Button>
                  {/*
                    Outside marketplaces sell straight from the wallet, while a
                    Digital Carat listing escrows the token, so the two cannot
                    both be live. The reserve and redemption rules still apply:
                    the contract refuses a sale while the token owes reserve and
                    holds none, or while a redemption is open.
                  */}
                  {openSeaUrl && (
                    <p className="col-span-2 text-[11.5px] leading-relaxed text-ink-dim">
                      You can also list this token on{' '}
                      <a
                        href={openSeaUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald hover:underline"
                      >
                        OpenSea ↗
                      </a>{' '}
                      from your wallet. It stays in your wallet until it sells there, while a
                      Digital Carat listing holds it in escrow, so cancel one before using the
                      other. While it is being redeemed, or owes reserve and holds none, it cannot
                      be sold anywhere.
                    </p>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5">
                  {mode.kind === 'primary-bid' ? (
                    <>
                      <p className="col-span-2 text-[11.5px] leading-relaxed text-ink-dim">
                        Not yet a token. Winning this 24-hour auction mints it to you — it is the
                        only way this gemstone becomes a token.
                      </p>
                      <Button
                        className="col-span-2"
                        disabled={primaryPaused}
                        onClick={() => modals.open('bid', gem)}
                      >
                        {primaryPaused ? 'Bidding paused' : 'Place bid'}
                      </Button>
                    </>
                  ) : mode.kind === 'primary-settle' ? (
                    <>
                      <p className="col-span-2 text-[11.5px] leading-relaxed text-ink-dim">
                        The auction has ended with a winning bid. Settling it mints the token to the
                        winner; anyone can do it.
                      </p>
                      <div className="col-span-2">
                        <TxButton
                          block
                          disabled={primaryPaused}
                          action={() => dataService.settleAuction({ gemId: gem.gemId })}
                          pendingLabel="Settling…"
                          telemetryFlow="settle_auction"
                        >
                          {primaryPaused ? 'Settlement paused' : 'Settle auction'}
                        </TxButton>
                      </div>
                    </>
                  ) : mode.kind === 'primary-upcoming' ? (
                    <p className="col-span-2 text-[11.5px] leading-relaxed text-ink-dim">
                      Not yet a token. Its auction has been scheduled and opens for bids{' '}
                      {new Date(Number(mode.auction.startTime) * 1_000).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                      .
                    </p>
                  ) : mode.kind === 'primary-unsold' ? (
                    <p className="col-span-2 text-[11.5px] leading-relaxed text-ink-dim">
                      Not yet a token. Its last auction ended without a bid, so there is nothing to
                      settle. It can be bid on again once a new round opens.
                    </p>
                  ) : mode.kind === 'primary-unavailable' ? (
                    <p className="col-span-2 text-[11.5px] leading-relaxed text-ink-dim">
                      {mode.loading
                        ? 'Checking this stone’s auction…'
                        : 'Not yet a token, and no auction is open for it right now. It becomes available to bid on when a round opens.'}
                    </p>
                  ) : mode.kind === 'listing' ? (
                    <>
                      <Button
                        onClick={() => modals.open('buy', gem)}
                        disabled={!gem.tokenId || mode.listingAuction !== 'none'}
                      >
                        {mode.listingAuction === 'none' ? 'Buy now' : 'Auction in progress'}
                      </Button>
                      {mode.listingAuction === 'ended' ? (
                        /*
                         * `createOffer` reverts `Expired` once the listing's
                         * auction has ended: there is nothing to bid on, only
                         * a sale to settle.
                         */
                        <Button variant="secondary" disabled>
                          Bidding closed
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          disabled={listingPaused}
                          onClick={() => modals.open('offer', gem)}
                        >
                          Place bid
                        </Button>
                      )}
                      {mode.listingAuction === 'ended' && settleListingButton}
                      <Button
                        variant="secondary"
                        className="col-span-2"
                        onClick={() => modals.open('swapFor', gem)}
                        disabled={!gem.tokenId}
                      >
                        Propose a swap
                      </Button>
                      {/*
                        Worth saying up front rather than after they have escrowed
                        a token. `SwapEscrow.acceptOffer` transfers the requested
                        token from whoever accepts, and a listed token is held by
                        the Marketplace — so the seller has to cancel first.
                      */}
                      <p className="col-span-2 text-[11.5px] leading-relaxed text-ink-dim">
                        {mode.listingAuction === 'ended'
                          ? 'This listing’s auction has ended. Settling it transfers the token to the winning bidder and pays the seller; anyone can do it.'
                          : 'Buying is immediate until a qualifying bid starts the 24-hour auction. Higher bids refund the previous bidder automatically, and once the timer ends the auction is settled to the winner without another seller approval. The seller must still cancel an unbid listing before it can be swapped.'}
                      </p>
                    </>
                  ) : mode.kind === 'escrowed' ? (
                    <p className="col-span-2 text-[11.5px] leading-relaxed text-ink-dim">
                      This token is held in escrow (a swap or gift card), so it cannot take offers
                      right now: an offer could not be accepted until it returns to a wallet.
                    </p>
                  ) : (
                    /*
                     * Held by someone who has not listed it. There is nothing to
                     * buy, so the two ways to acquire it are an offer the owner
                     * can accept, or a swap of one token for another.
                     */
                    <>
                      <p className="col-span-2 text-[11.5px] leading-relaxed text-ink-dim">
                        This token is not listed for sale. You can offer to buy it, or propose
                        trading one of your own tokens for it.
                      </p>
                      <Button
                        onClick={() => modals.open('offer', gem)}
                        disabled={!gem.tokenId || listingPaused}
                      >
                        Make an offer
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => modals.open('swapFor', gem)}
                        disabled={!gem.tokenId}
                      >
                        Propose a swap
                      </Button>
                    </>
                  )}
                  {!gem.funded && gem.tokenId !== undefined && (
                    <Button
                      variant="ghost"
                      className="col-span-2"
                      onClick={() => modals.open('reserve', gem)}
                    >
                      Fund reserve shortfall
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="font-display text-[15px] font-medium text-ink">Provenance</h3>
              <span className="font-mono text-[9.5px] uppercase tracking-[0.13em] text-ink-dim">
                On chain
              </span>
            </div>
            <p className="mb-2 text-[11.5px] leading-relaxed text-ink-dim">
              Each gate is enforced by a separate role, so no single party can move a gem from
              intake to sale on its own.
            </p>
            <ProvenanceChain gem={gem} />
          </Card>

          <Card className="p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-[15px] font-medium text-ink">Custody record</h3>
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.13em] text-emerald">
                Public fields only
              </span>
            </div>
            <dl className="divide-y divide-line/[0.06]">
              {specs.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between py-2.5 text-[13.5px]">
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="text-ink-soft">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>

      <GemActionModals state={modals.state} onClose={modals.close} />
    </div>
  );
}
