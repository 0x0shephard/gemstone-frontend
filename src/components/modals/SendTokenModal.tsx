import { useState } from 'react';
import { isAddress, getAddress, type Address } from 'viem';
import { useAccount } from 'wagmi';
import type { DecoratedGem } from '@/services/types';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { TxButton } from '@/components/tx/TxButton';
import { ModalGemHeader } from './parts';
import { GiftCardComposer } from '@/components/gift/GiftCardComposer';
import { dataService } from '@/services';

type Mode = 'choose' | 'wallet' | 'gift';

interface SendTokenModalProps {
  gem: DecoratedGem;
  open: boolean;
  onClose: () => void;
}

/**
 * Sending an owned token, by either of the two routes in the design notes.
 *
 * A wallet transfer is immediate and final. A gift card is not a transfer at
 * all: the sender keeps the token and approves the protocol to move it once,
 * when whoever holds the card claims it. Nothing is escrowed and nothing is
 * forfeited — an unclaimed card simply expires.
 */
export function SendTokenModal({ gem, open, onClose }: SendTokenModalProps) {
  const [mode, setMode] = useState<Mode>('choose');

  const close = () => {
    setMode('choose');
    onClose();
  };

  if (mode === 'gift') {
    return (
      <GiftCardComposer gem={gem} open={open} onClose={close} onBack={() => setMode('choose')} />
    );
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Send token"
      subtitle={
        mode === 'wallet'
          ? 'Transfers immediately and cannot be undone.'
          : 'Choose how this token reaches its recipient.'
      }
      maxWidth={mode === 'wallet' ? 480 : 520}
    >
      <ModalGemHeader gem={gem} />
      {mode === 'choose' ? (
        <ChooseRoute onPick={setMode} />
      ) : (
        <WalletTransfer gem={gem} onBack={() => setMode('choose')} onDone={close} />
      )}
    </Modal>
  );
}

function ChooseRoute({ onPick }: { onPick: (mode: Mode) => void }) {
  return (
    <div className="grid gap-2.5">
      <RouteCard
        title="Send to wallet address"
        detail="Straight ERC-721 transfer to an address you already know. Arrives as soon as the transaction confirms."
        onClick={() => onPick('wallet')}
      />
      <RouteCard
        title="Make a gift card"
        detail="A printable card with a QR code. The recipient scans it, verifies their email, and the token transfers to their wallet. You keep it until then."
        onClick={() => onPick('gift')}
      />
    </div>
  );
}

function RouteCard({
  title,
  detail,
  onClick,
}: {
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="dc-btn-anim group rounded-[4px] border border-line/[0.1] bg-panel p-4 text-left transition-colors hover:border-line/[0.2] hover:bg-line/[0.045]"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[14px] font-semibold text-ink">{title}</span>
        <span
          aria-hidden
          className="text-[15px] text-ink-dim transition-transform group-hover:translate-x-0.5"
        >
          →
        </span>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-dim">{detail}</p>
    </button>
  );
}

function WalletTransfer({
  gem,
  onBack,
  onDone,
}: {
  gem: DecoratedGem;
  onBack: () => void;
  onDone: () => void;
}) {
  const { address: connected } = useAccount();
  const [recipient, setRecipient] = useState('');

  const trimmed = recipient.trim();
  const valid = isAddress(trimmed);
  // Checksum both sides: `isAddressEqual` throws on a string that is not an
  // address, and this field is being typed into one character at a time.
  const isSelf = valid && connected ? getAddress(trimmed) === getAddress(connected) : false;
  const error = trimmed.length > 0 && !valid ? 'Not a valid Ethereum address.' : undefined;

  return (
    <>
      <Field
        label="Recipient wallet address"
        placeholder="0x…"
        spellCheck={false}
        autoComplete="off"
        value={recipient}
        onChange={(event) => setRecipient(event.target.value)}
        error={error}
      />
      {isSelf && (
        <p className="text-[11.5px] text-ink-dim">
          That is the wallet you are connected with — the token is already there.
        </p>
      )}
      <div className="rounded-[4px] border border-amber/25 bg-amber/[0.06] p-3">
        <p className="text-[11.5px] leading-relaxed text-ink-muted">
          Check the address carefully. A transfer to the wrong address cannot be reversed by anyone,
          including Digital Carat. The reserve and redemption rights travel with the token.
        </p>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-2.5">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <TxButton
          block
          disabled={!valid || isSelf}
          action={() =>
            dataService.transferToken({
              tokenId: gem.tokenId!,
              to: getAddress(trimmed) as Address,
            })
          }
          pendingLabel="Transferring…"
          telemetryFlow="token_transfer"
          onDone={onDone}
          doneLabel="Close"
        >
          Send token
        </TxButton>
      </div>
    </>
  );
}
