import { useState } from 'react';
import type { DecoratedGem, PaymentAsset } from '@/services/types';
import { Modal } from '@/components/ui/Modal';
import { Field, inputClass } from '@/components/ui/Field';
import { TxButton } from '@/components/tx/TxButton';
import { PaymentAssetSelector } from '@/components/payment/PaymentAssetSelector';
import { ReserveStatus } from '@/components/gem/ReserveStatus';
import { ModalGemHeader, SummaryRow, assetAmountPreview } from './parts';
import { dataService } from '@/services';
import { reserveShortfallUsd } from '@/lib/gem';
import { fmtUsd } from '@/lib/format';
import { useGems, useProfile } from '@/hooks/useData';
import { NATIVE_ASSET } from '@/config/contracts';
import { zeroHash } from 'viem';
import { useAccount } from 'wagmi';
import { env } from '@/config/env';
import { createRedemptionCommitment } from '@/services/offchain/workflows';

interface BaseModalProps {
  gem: DecoratedGem;
  open: boolean;
  onClose: () => void;
}

function ApprovalNote({ asset }: { asset?: PaymentAsset }) {
  if (!asset || asset.isNative) return null;
  return (
    <p className="text-[11.5px] text-ink-dim">
      {asset.symbol} is an ERC-20 — you&apos;ll approve the allowance before the transfer. Native
      ETH needs no approval.
    </p>
  );
}

/* ------------------------------ Bid ------------------------------ */
export function BidModal({ gem, open, onClose }: BaseModalProps) {
  const [asset, setAsset] = useState<PaymentAsset>();
  const [amount, setAmount] = useState('');
  const saleUsd = Number(amount) || 0;
  const shortfall = reserveShortfallUsd(gem);
  const total = saleUsd + shortfall;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Place a bid"
      subtitle="Highest bid wins at auction close."
    >
      <ModalGemHeader gem={gem} />
      <Field
        label="Bid amount (USD)"
        inputMode="decimal"
        placeholder="0"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <div>
        <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">Payment asset</span>
        <PaymentAssetSelector value={asset?.address} onChange={setAsset} />
        {saleUsd > 0 && (
          <p className="mt-1.5 font-mono text-[11.5px] text-ink-dim">
            {assetAmountPreview(total, asset)}
          </p>
        )}
      </div>
      {saleUsd > 0 && (
        <div className="rounded-[4px] border border-line/[0.08] bg-panel p-3">
          <SummaryRow label="Bid credited to auction" value={fmtUsd(saleUsd)} />
          {shortfall > 0 && (
            <SummaryRow label="Reserve top-up" value={fmtUsd(shortfall)} accent="var(--dc-amber)" />
          )}
          <div className="my-1 h-px bg-line/[0.06]" />
          <SummaryRow label="Total escrowed" value={fmtUsd(total)} />
        </div>
      )}
      <ApprovalNote asset={asset} />
      <TxButton
        block
        disabled={!asset || saleUsd <= 0}
        action={() =>
          dataService.bid({
            gemId: gem.gemId,
            paymentAsset: asset!.address,
            saleAmountUsd: BigInt(Math.round(saleUsd * 1e6)) * 10n ** 12n,
          })
        }
        pendingLabel="Submitting bid…"
        onDone={onClose}
      >
        Place bid · {saleUsd > 0 ? fmtUsd(total) : '—'}
      </TxButton>
    </Modal>
  );
}

/* -------------------------- Fund reserve -------------------------- */
export function FundReserveModal({ gem, open, onClose }: BaseModalProps) {
  const [asset, setAsset] = useState<PaymentAsset>();
  const shortfall = reserveShortfallUsd(gem);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Fund reserve shortfall"
      subtitle="Top up the on-chain reserve for this gem."
    >
      <ModalGemHeader gem={gem} />
      <ReserveStatus gem={gem} />
      <SummaryRow label="Shortfall due" value={fmtUsd(shortfall)} accent="var(--dc-amber)" />
      <div>
        <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">Payment asset</span>
        <PaymentAssetSelector value={asset?.address} onChange={setAsset} />
        <p className="mt-1.5 font-mono text-[11.5px] text-ink-dim">
          {assetAmountPreview(shortfall, asset)}
        </p>
      </div>
      <ApprovalNote asset={asset} />
      <TxButton
        block
        disabled={!asset || gem.funded}
        action={() =>
          dataService.fundReserve({
            gemId: gem.gemId,
            paymentAsset: asset!.address,
            amountUsd: gem.reserveShortfallUsd,
          })
        }
        pendingLabel="Funding reserve…"
        onDone={onClose}
      >
        {gem.funded ? 'Reserve already funded' : `Fund ${fmtUsd(shortfall)}`}
      </TxButton>
    </Modal>
  );
}

/* ------------------------------ Buy ------------------------------ */
export function BuyModal({
  gem,
  open,
  onClose,
  mode = 'buyNow',
}: BaseModalProps & { mode?: 'buyNow' | 'buy' }) {
  const [asset, setAsset] = useState<PaymentAsset>();
  const shortfall = reserveShortfallUsd(gem);
  const total = gem.value + shortfall;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'buyNow' ? 'Buy now' : 'Purchase listing'}
      subtitle="Reserve shortfall is included in your total."
    >
      <ModalGemHeader gem={gem} />
      <div className="rounded-[4px] border border-line/[0.08] bg-panel p-3">
        <SummaryRow label="Listed price" value={gem.valueFmt} />
        {shortfall > 0 && (
          <SummaryRow label="Reserve top-up" value={fmtUsd(shortfall)} accent="var(--dc-amber)" />
        )}
        <div className="my-1 h-px bg-line/[0.06]" />
        <SummaryRow label="Total required" value={fmtUsd(total)} />
      </div>
      <p className="text-[11.5px] leading-relaxed text-ink-dim">
        {mode === 'buyNow'
          ? 'The listed price follows the on-chain 80 / 8 / 6 / 4 / 2 treasury split. Any reserve shortfall is a separate buyer-funded charge and is not included in that split.'
          : 'The marketplace fee and seller proceeds are calculated on the listing price. Any reserve shortfall is funded separately before transfer.'}
      </p>
      <div>
        <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">Payment asset</span>
        <PaymentAssetSelector value={asset?.address} onChange={setAsset} />
        <p className="mt-1.5 font-mono text-[11.5px] text-ink-dim">
          {assetAmountPreview(total, asset)}
        </p>
      </div>
      <ApprovalNote asset={asset} />
      <TxButton
        block
        disabled={!asset}
        action={() =>
          mode === 'buyNow'
            ? dataService.buyNow({ gemId: gem.gemId, paymentAsset: asset!.address })
            : dataService.buy({ tokenId: gem.tokenId!, paymentAsset: asset!.address })
        }
        pendingLabel="Processing purchase…"
        onDone={onClose}
        doneLabel="Done — view in your portfolio"
      >
        Pay {fmtUsd(total)}
      </TxButton>
    </Modal>
  );
}

/* ----------------------------- Offer ----------------------------- */
export function OfferModal({ gem, open, onClose }: BaseModalProps) {
  const [asset, setAsset] = useState<PaymentAsset>();
  const [amount, setAmount] = useState('');
  const usd = Number(amount) || 0;
  const shortfall = reserveShortfallUsd(gem);
  const total = usd + shortfall;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Make an offer"
      subtitle="Offers expire automatically after 24 hours."
    >
      <ModalGemHeader gem={gem} />
      <Field
        label="Offer amount (USD)"
        inputMode="decimal"
        placeholder="0"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <div>
        <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">Payment asset</span>
        <PaymentAssetSelector value={asset?.address} onChange={setAsset} />
        {usd > 0 && (
          <p className="mt-1.5 font-mono text-[11.5px] text-ink-dim">
            {assetAmountPreview(total, asset)}
          </p>
        )}
      </div>
      {usd > 0 && (
        <div className="rounded-[4px] border border-line/[0.08] bg-panel p-3">
          <SummaryRow label="Offer to token owner" value={fmtUsd(usd)} />
          {shortfall > 0 && (
            <SummaryRow label="Reserve top-up" value={fmtUsd(shortfall)} accent="var(--dc-amber)" />
          )}
          <div className="my-1 h-px bg-line/[0.06]" />
          <SummaryRow label="Total escrowed" value={fmtUsd(total)} />
        </div>
      )}
      <ApprovalNote asset={asset} />
      <TxButton
        block
        disabled={!asset || !gem.tokenId || usd <= 0}
        action={() =>
          dataService.createOffer({
            tokenId: gem.tokenId!,
            paymentAsset: asset!.address,
            saleAmountUsd: BigInt(Math.round(usd * 1e6)) * 10n ** 12n,
          })
        }
        pendingLabel="Submitting offer…"
        onDone={onClose}
      >
        Submit offer · {usd > 0 ? fmtUsd(total) : '—'}
      </TxButton>
    </Modal>
  );
}

/* ------------------------------ List ----------------------------- */
export function ListModal({ gem, open, onClose }: BaseModalProps) {
  const [price, setPrice] = useState(String(gem.value));
  const usd = Number(price) || 0;
  const validPrice = usd >= gem.value;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="List for sale"
      subtitle="You must approve the NFT to the Marketplace to list."
    >
      <ModalGemHeader gem={gem} />
      <Field
        label="List price (USD)"
        inputMode="decimal"
        placeholder="0"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
      />
      <p className="text-[11.5px] text-ink-dim">
        Listing approves the token to the Marketplace contract, then records the price on-chain. The
        secondary price cannot be below the expert-approved primary value of {gem.valueFmt}.
      </p>
      <TxButton
        block
        disabled={!gem.tokenId || !validPrice}
        action={() =>
          dataService.list({
            tokenId: gem.tokenId!,
            priceUsd: BigInt(Math.round(usd * 1e6)) * 10n ** 12n,
          })
        }
        pendingLabel="Listing…"
        onDone={onClose}
      >
        List at {usd > 0 ? fmtUsd(usd) : '—'}
      </TxButton>
    </Modal>
  );
}

/* ------------------------------ Swap ----------------------------- */
/**
 * `direction` decides which side of the trade the viewed gem sits on.
 *
 * `offer` is the owner's view: this token is what they give. `request` is
 * everyone else's — the token belongs to someone else, so it is what they want,
 * and they choose one of their own to offer. Getting this backwards would build
 * a swap offering a token the proposer does not hold, which `SwapEscrow`
 * rejects.
 */
export function SwapModal({
  gem,
  open,
  onClose,
  direction = 'offer',
}: BaseModalProps & { direction?: 'offer' | 'request' }) {
  const { address } = useAccount();
  const { data: gems = [] } = useGems();
  const { data: profile } = useProfile(address);
  const requesting = direction === 'request';
  // Offering someone else's token is impossible, so the picker lists only what
  // the connected wallet actually owns.
  const choices = requesting ? (profile?.owned ?? []) : gems;
  const [requestedId, setRequestedId] = useState('');
  const [delta, setDelta] = useState('');
  const [asset, setAsset] = useState<PaymentAsset>();
  const [proposerPays, setProposerPays] = useState(true);
  const counterpart = choices.find((g) => g.gemId.toString() === requestedId);
  // `offered` is what leaves the proposer's wallet; `requested` is what arrives.
  const offered = requesting ? counterpart : gem;
  const requested = requesting ? gem : counterpart;
  const reservesReady = Boolean(offered?.funded) && Boolean(requested?.funded);
  const usd = Number(delta) || 0;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Propose a swap"
      subtitle="Trade one gem NFT for another, with an optional cash delta."
    >
      <div>
        <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">
          {requesting ? 'You receive' : 'You give'}
        </span>
        <ModalGemHeader gem={gem} />
      </div>
      <div>
        <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">
          {requesting ? 'You give' : 'You receive'}
        </span>
        <select
          className={inputClass}
          value={requestedId}
          onChange={(e) => setRequestedId(e.target.value)}
        >
          <option value="">{requesting ? 'Select one of your tokens…' : 'Select a gem…'}</option>
          {choices
            .filter((g) => g.gemId !== gem.gemId && g.tokenId)
            .map((g) => (
              <option key={g.gemId.toString()} value={g.gemId.toString()}>
                {g.name} · {g.displayId}
              </option>
            ))}
        </select>
        {requesting && choices.length === 0 && (
          <p className="mt-1.5 text-[11.5px] text-amber">
            You hold no tokens to trade. Win one at auction first.
          </p>
        )}
      </div>
      <ReserveStatus gem={gem} />
      {counterpart && <ReserveStatus gem={counterpart} />}
      {counterpart && !reservesReady && (
        <p className="rounded-[4px] border border-amber/25 bg-amber/5 px-3 py-2 text-[11.5px] text-amber">
          Both NFTs must be fully reserve-funded before this swap can settle.
        </p>
      )}
      <Field
        label="Cash adjustment (USD, optional)"
        inputMode="decimal"
        placeholder="0"
        value={delta}
        onChange={(e) => setDelta(e.target.value)}
      />
      {usd > 0 && (
        <>
          <div>
            <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">
              Payment asset
            </span>
            <PaymentAssetSelector value={asset?.address} onChange={setAsset} />
            <p className="mt-1.5 font-mono text-[11.5px] text-ink-dim">
              {assetAmountPreview(usd, asset)}
            </p>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-[12px] font-medium text-ink-muted">
              Who pays the adjustment?
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: true, label: 'I pay', detail: 'Escrowed now' },
                { value: false, label: 'They pay', detail: 'Due on acceptance' },
              ].map((option) => {
                const selected = proposerPays === option.value;
                return (
                  <label
                    key={String(option.value)}
                    className={`cursor-pointer rounded-[4px] border px-3.5 py-3 transition-colors focus-within:ring-2 focus-within:ring-atelier/60 ${
                      selected
                        ? 'border-atelier/40 bg-atelier/[0.08]'
                        : 'border-line/[0.09] bg-inset hover:border-line/[0.16]'
                    }`}
                  >
                    <input
                      className="sr-only"
                      type="radio"
                      name="swap-payer"
                      checked={selected}
                      onChange={() => setProposerPays(option.value)}
                    />
                    <span className="block text-[12.5px] font-semibold text-ink">
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-[10.5px] text-ink-dim">{option.detail}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <ApprovalNote asset={proposerPays ? asset : undefined} />
        </>
      )}
      <p className="text-[11.5px] text-ink-dim">
        Your offered NFT is escrowed when you propose the swap. Cash is quoted on-chain immediately
        before the transaction.
      </p>
      <TxButton
        block
        disabled={!offered?.tokenId || !requested?.tokenId || !reservesReady || (usd > 0 && !asset)}
        action={() =>
          dataService.createSwap({
            offeredTokenId: offered!.tokenId!,
            requestedTokenId: requested!.tokenId!,
            paymentAsset: asset?.address ?? NATIVE_ASSET,
            cashAmountUsd: BigInt(Math.round(usd * 1e6)) * 10n ** 12n,
            proposerPays,
            expiresAt: BigInt(Math.floor(Date.now() / 1000) + 86_400),
          })
        }
        pendingLabel="Creating swap…"
        onDone={onClose}
      >
        Propose swap
      </TxButton>
    </Modal>
  );
}

/* ----------------------------- Redeem ---------------------------- */
export function RedeemModal({ gem, open, onClose }: BaseModalProps) {
  const { address } = useAccount();
  const [method, setMethod] = useState<'pickup' | 'insured_delivery'>('pickup');
  const [details, setDetails] = useState({
    pickupLocation: '',
    recipientName: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    region: '',
    postalCode: '',
    country: '',
  });
  const canRedeem = gem.funded && gem.redeem === 'Eligible';
  const fulfillmentValid =
    method === 'pickup'
      ? details.pickupLocation.length > 0
      : Boolean(
          details.recipientName &&
          details.addressLine1 &&
          details.city &&
          details.postalCode &&
          details.country,
        );
  const request = async () => {
    if (!gem.tokenId || !address) throw new Error('A connected verified wallet is required');
    const requestHash =
      env.dataMode === 'chain'
        ? (
            await createRedemptionCommitment({
              wallet: address,
              gemId: gem.gemId,
              tokenId: gem.tokenId,
              fulfillmentMethod: method,
              fulfillmentDetails: details,
            })
          ).requestHash
        : zeroHash;
    return dataService.requestRedemption({ tokenId: gem.tokenId, requestHash });
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Redeem physical gemstone"
      subtitle="Private fulfillment details are committed off-chain before the NFT is locked."
    >
      <ModalGemHeader gem={gem} />
      <ul className="space-y-2 text-[13px]">
        <CheckRow ok label="You own this token" />
        <CheckRow ok={gem.funded} label="Reserve fully funded" />
        <CheckRow ok={gem.redeem === 'Eligible'} label="Compliance check passed (canRedeem)" />
      </ul>
      <div>
        <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">
          Fulfillment method
        </span>
        <select
          className={inputClass}
          value={method}
          onChange={(event) => setMethod(event.target.value as typeof method)}
        >
          <option value="pickup">Secure vault pickup</option>
          <option value="insured_delivery">Insured delivery</option>
        </select>
      </div>
      {method === 'pickup' ? (
        <Field
          label="Preferred pickup location"
          placeholder="Zurich or Geneva"
          value={details.pickupLocation}
          onChange={(event) =>
            setDetails((current) => ({ ...current, pickupLocation: event.target.value }))
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Recipient name"
            value={details.recipientName}
            onChange={(event) =>
              setDetails((current) => ({ ...current, recipientName: event.target.value }))
            }
          />
          <Field
            label="Address line 1"
            value={details.addressLine1}
            onChange={(event) =>
              setDetails((current) => ({ ...current, addressLine1: event.target.value }))
            }
          />
          <Field
            label="Address line 2"
            value={details.addressLine2}
            onChange={(event) =>
              setDetails((current) => ({ ...current, addressLine2: event.target.value }))
            }
          />
          <Field
            label="City"
            value={details.city}
            onChange={(event) =>
              setDetails((current) => ({ ...current, city: event.target.value }))
            }
          />
          <Field
            label="State / region"
            value={details.region}
            onChange={(event) =>
              setDetails((current) => ({ ...current, region: event.target.value }))
            }
          />
          <Field
            label="Postal code"
            value={details.postalCode}
            onChange={(event) =>
              setDetails((current) => ({ ...current, postalCode: event.target.value }))
            }
          />
          <Field
            label="Country"
            className="sm:col-span-2"
            value={details.country}
            onChange={(event) =>
              setDetails((current) => ({ ...current, country: event.target.value }))
            }
          />
        </div>
      )}
      <p className="rounded-[4px] border border-atelier/25 bg-atelier/5 px-3 py-2 text-[11.5px] text-ink-muted">
        Your name and address remain private. The chain receives only a reproducible commitment hash
        tied to this workflow record.
      </p>
      <div className="rounded-[4px] border border-ruby/30 bg-ruby/[0.07] px-3 py-2 text-[12px] text-ruby">
        Redemption is irreversible. On custodian confirmation, the NFT is burned and the physical
        gemstone is released from the vault.
      </div>
      <TxButton
        block
        variant="danger"
        disabled={!canRedeem || !gem.tokenId || !address || !fulfillmentValid}
        action={request}
        pendingLabel="Requesting redemption…"
        onDone={onClose}
      >
        {canRedeem
          ? 'Request redemption'
          : gem.redeem === 'KYC required'
            ? 'KYC required to redeem'
            : 'Reserve top-up required'}
      </TxButton>
    </Modal>
  );
}

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2.5">
      <span
        className="flex h-4 w-4 items-center justify-center rounded-full text-[10px]"
        style={{
          background: ok ? 'rgba(76,201,154,.18)' : 'rgba(233,173,91,.18)',
          color: ok ? 'var(--dc-emerald)' : 'var(--dc-amber)',
        }}
      >
        {ok ? '✓' : '!'}
      </span>
      <span className={ok ? 'text-ink-soft' : 'text-amber'}>{label}</span>
    </li>
  );
}
