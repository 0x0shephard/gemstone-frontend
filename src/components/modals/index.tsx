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
import { useGems } from '@/hooks/useData';

interface BaseModalProps {
  gem: DecoratedGem;
  open: boolean;
  onClose: () => void;
}

function ApprovalNote({ asset }: { asset?: PaymentAsset }) {
  if (!asset || asset.isNative) return null;
  return (
    <p className="text-[11.5px] text-ink-dim">
      {asset.symbol} is an ERC-20 — you&apos;ll approve the allowance before the transfer. Native ETH
      needs no approval.
    </p>
  );
}

/* ------------------------------ Bid ------------------------------ */
export function BidModal({ gem, open, onClose }: BaseModalProps) {
  const [asset, setAsset] = useState<PaymentAsset>();
  const [amount, setAmount] = useState('');
  const usd = Number(amount) || 0;
  return (
    <Modal open={open} onClose={onClose} title="Place a bid" subtitle="Highest bid wins at auction close.">
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
        {usd > 0 && <p className="mt-1.5 font-mono text-[11.5px] text-ink-dim">{assetAmountPreview(usd, asset)}</p>}
      </div>
      <ApprovalNote asset={asset} />
      <TxButton
        block
        disabled={!asset || usd <= 0}
        action={() => dataService.bid(gem.id, asset!.address, usd)}
        pendingLabel="Submitting bid…"
        onDone={onClose}
      >
        Place bid · {usd > 0 ? fmtUsd(usd) : '—'}
      </TxButton>
    </Modal>
  );
}

/* -------------------------- Fund reserve -------------------------- */
export function FundReserveModal({ gem, open, onClose }: BaseModalProps) {
  const [asset, setAsset] = useState<PaymentAsset>();
  const shortfall = reserveShortfallUsd(gem);
  return (
    <Modal open={open} onClose={onClose} title="Fund reserve shortfall" subtitle="Top up the on-chain reserve for this gem.">
      <ModalGemHeader gem={gem} />
      <ReserveStatus gem={gem} />
      <SummaryRow label="Shortfall due" value={fmtUsd(shortfall)} accent="#E5A23C" />
      <div>
        <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">Payment asset</span>
        <PaymentAssetSelector value={asset?.address} onChange={setAsset} />
        <p className="mt-1.5 font-mono text-[11.5px] text-ink-dim">{assetAmountPreview(shortfall, asset)}</p>
      </div>
      <ApprovalNote asset={asset} />
      <TxButton
        block
        disabled={!asset || gem.funded}
        action={() => dataService.fundReserve(gem.id, asset!.address)}
        pendingLabel="Funding reserve…"
        onDone={onClose}
      >
        {gem.funded ? 'Reserve already funded' : `Fund ${fmtUsd(shortfall)}`}
      </TxButton>
    </Modal>
  );
}

/* ------------------------------ Buy ------------------------------ */
export function BuyModal({ gem, open, onClose, mode = 'buyNow' }: BaseModalProps & { mode?: 'buyNow' | 'buy' }) {
  const [asset, setAsset] = useState<PaymentAsset>();
  const shortfall = reserveShortfallUsd(gem);
  const total = gem.value + shortfall;
  return (
    <Modal open={open} onClose={onClose} title={mode === 'buyNow' ? 'Buy now' : 'Purchase listing'} subtitle="Reserve shortfall is included in your total.">
      <ModalGemHeader gem={gem} />
      <div className="rounded-[12px] border border-white/[0.08] bg-panel p-3">
        <SummaryRow label="Listed price" value={gem.valueFmt} />
        {shortfall > 0 && <SummaryRow label="Reserve top-up" value={fmtUsd(shortfall)} accent="#E5A23C" />}
        <div className="my-1 h-px bg-white/[0.06]" />
        <SummaryRow label="Total required" value={fmtUsd(total)} />
      </div>
      <div>
        <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">Payment asset</span>
        <PaymentAssetSelector value={asset?.address} onChange={setAsset} />
        <p className="mt-1.5 font-mono text-[11.5px] text-ink-dim">{assetAmountPreview(total, asset)}</p>
      </div>
      <ApprovalNote asset={asset} />
      <TxButton
        block
        disabled={!asset}
        action={() => (mode === 'buyNow' ? dataService.buyNow(gem.id, asset!.address) : dataService.buy(gem.id, asset!.address))}
        pendingLabel="Processing purchase…"
        onDone={onClose}
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
  return (
    <Modal open={open} onClose={onClose} title="Make an offer" subtitle="Offers expire automatically after 24 hours.">
      <ModalGemHeader gem={gem} />
      <Field label="Offer amount (USD)" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <div>
        <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">Payment asset</span>
        <PaymentAssetSelector value={asset?.address} onChange={setAsset} />
        {usd > 0 && <p className="mt-1.5 font-mono text-[11.5px] text-ink-dim">{assetAmountPreview(usd, asset)}</p>}
      </div>
      <ApprovalNote asset={asset} />
      <TxButton block disabled={!asset || usd <= 0} action={() => dataService.createOffer(gem.id, asset!.address, usd)} pendingLabel="Submitting offer…" onDone={onClose}>
        Submit offer · {usd > 0 ? fmtUsd(usd) : '—'}
      </TxButton>
    </Modal>
  );
}

/* ------------------------------ List ----------------------------- */
export function ListModal({ gem, open, onClose }: BaseModalProps) {
  const [price, setPrice] = useState(String(gem.value));
  const usd = Number(price) || 0;
  return (
    <Modal open={open} onClose={onClose} title="List for sale" subtitle="You must approve the NFT to the Marketplace to list.">
      <ModalGemHeader gem={gem} />
      <Field label="List price (USD)" inputMode="decimal" placeholder="0" value={price} onChange={(e) => setPrice(e.target.value)} />
      <p className="text-[11.5px] text-ink-dim">Listing approves the token to the Marketplace contract, then records the price on-chain.</p>
      <TxButton block disabled={usd <= 0} action={() => dataService.list(gem.id, usd)} pendingLabel="Listing…" onDone={onClose}>
        List at {usd > 0 ? fmtUsd(usd) : '—'}
      </TxButton>
    </Modal>
  );
}

/* ------------------------------ Swap ----------------------------- */
export function SwapModal({ gem, open, onClose }: BaseModalProps) {
  const { data: gems = [] } = useGems();
  const [requestedId, setRequestedId] = useState('');
  const [delta, setDelta] = useState('');
  const requested = gems.find((g) => g.id === requestedId);
  return (
    <Modal open={open} onClose={onClose} title="Propose a swap" subtitle="Trade one gem NFT for another, with an optional cash delta.">
      <div>
        <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">You give</span>
        <ModalGemHeader gem={gem} />
      </div>
      <div>
        <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">You receive</span>
        <select className={inputClass} value={requestedId} onChange={(e) => setRequestedId(e.target.value)}>
          <option value="">Select a gem…</option>
          {gems
            .filter((g) => g.id !== gem.id)
            .map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} · {g.gemId}
              </option>
            ))}
        </select>
      </div>
      {requested && <ReserveStatus gem={requested} />}
      <Field label="Cash delta (USD, optional)" inputMode="decimal" placeholder="0" value={delta} onChange={(e) => setDelta(e.target.value)} />
      <p className="text-[11.5px] text-ink-dim">Proposing approves your offered NFT to the SwapEscrow contract.</p>
      <TxButton block disabled={!requestedId} action={() => dataService.createSwap(gem.id, requestedId, Number(delta) || 0)} pendingLabel="Creating swap…" onDone={onClose}>
        Propose swap
      </TxButton>
    </Modal>
  );
}

/* ----------------------------- Redeem ---------------------------- */
export function RedeemModal({ gem, open, onClose }: BaseModalProps) {
  const canRedeem = gem.funded && gem.redeem === 'Eligible';
  return (
    <Modal open={open} onClose={onClose} title="Redeem physical gemstone" subtitle="This locks and burns your NFT to release the stone.">
      <ModalGemHeader gem={gem} />
      <ul className="space-y-2 text-[13px]">
        <CheckRow ok label="You own this token" />
        <CheckRow ok={gem.funded} label="Reserve fully funded" />
        <CheckRow ok={gem.redeem === 'Eligible'} label="Compliance check passed (canRedeem)" />
      </ul>
      <div
        className="rounded-[8px] px-3 py-2 text-[12px]"
        style={{ background: 'rgba(229,72,77,.06)', border: '1px solid rgba(229,72,77,.28)', color: '#F0B8BA' }}
      >
        Redemption is irreversible. On custodian confirmation, the NFT is burned and the physical
        gemstone is released from the vault.
      </div>
      <TxButton
        block
        variant="danger"
        disabled={!canRedeem}
        action={() => dataService.requestRedemption(gem.id)}
        pendingLabel="Requesting redemption…"
        onDone={onClose}
      >
        {canRedeem ? 'Request redemption' : gem.redeem === 'KYC required' ? 'KYC required to redeem' : 'Reserve top-up required'}
      </TxButton>
    </Modal>
  );
}

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2.5">
      <span
        className="flex h-4 w-4 items-center justify-center rounded-full text-[10px]"
        style={{ background: ok ? 'rgba(53,185,138,.18)' : 'rgba(229,162,60,.18)', color: ok ? '#35B98A' : '#E5A23C' }}
      >
        {ok ? '✓' : '!'}
      </span>
      <span className={ok ? 'text-ink-soft' : 'text-amber'}>{label}</span>
    </li>
  );
}
