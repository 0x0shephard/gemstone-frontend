import { useEffect, useRef, useState } from 'react';
import type { DecoratedGem } from '@/services/types';
import { Modal } from '@/components/ui/Modal';
import { Field, Labeled, inputClass } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { TxButton } from '@/components/tx/TxButton';
import { ModalGemHeader } from '@/components/modals/parts';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  GIFT_TEMPLATES,
  GiftCardArt,
  templateLabel,
  type GiftTemplate,
} from './GiftCardArt';
import { giftOperatorAddress } from '@/config/contracts';
import { dataService } from '@/services';
import {
  createGiftCard,
  emailGiftCard,
  giftClaimUrl,
  type CreatedGiftCard,
} from '@/services/offchain/gift';
import {
  cardAsPngBase64,
  downloadCardPng,
  downloadCardSvg,
  inlineImage,
  printCard,
} from '@/lib/cardExport';
import {
  exportCardToCanva,
  needsCanvaConnection,
  startCanvaAuthorization,
} from '@/services/offchain/canva';
import { cn } from '@/lib/cn';

type Step = 'compose' | 'approve' | 'issued';

interface GiftCardComposerProps {
  gem: DecoratedGem;
  open: boolean;
  onClose: () => void;
  onBack: () => void;
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;
const MAX_MESSAGE = 500;

/**
 * Composes, issues and hands over a gift card.
 *
 * Three steps, in an order that matters. The details are settled first, then
 * the single wallet signature that grants the operator permission to move this
 * one token, and only then is the card issued — so a sender who abandons the
 * flow at the signature has granted nothing and left no half-made card behind.
 */
export function GiftCardComposer({ gem, open, onClose, onBack }: GiftCardComposerProps) {
  const [step, setStep] = useState<Step>('compose');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [message, setMessage] = useState('');
  const [template, setTemplate] = useState<GiftTemplate>('classic');
  const [issued, setIssued] = useState<CreatedGiftCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);

  const email = recipientEmail.trim().toLowerCase();
  const emailValid = EMAIL_PATTERN.test(email);

  if (!giftOperatorAddress) {
    return (
      <Modal open={open} onClose={onClose} title="Gift cards are not available">
        <p className="text-[13px] leading-relaxed text-ink-muted">
          This deployment has no gift operator address configured, so there is nothing to authorise
          a claim with. Sending straight to a wallet address still works.
        </p>
        <Button block variant="secondary" onClick={onBack}>
          Back
        </Button>
      </Modal>
    );
  }

  async function issue() {
    // The confirmation button stays mounted while this runs, and a second
    // create would collide with the one-active-card index and report a conflict
    // the sender did not cause.
    if (issuing) return;
    setIssuing(true);
    setError(null);
    try {
      const card = await createGiftCard({
        tokenId: gem.tokenId!,
        recipientEmail: email,
        recipientName: recipientName.trim() || undefined,
        message: message.trim() || undefined,
        template,
      });
      setIssued(card);
      setStep('issued');
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : 'Could not issue the gift card');
    } finally {
      setIssuing(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth={step === 'issued' ? 760 : 520}
      title={step === 'issued' ? 'Gift card ready' : 'Make a gift card'}
      subtitle={
        step === 'issued'
          ? 'Print it, or send the link. It is claimable once.'
          : 'You keep the token until someone claims the card.'
      }
    >
      {step !== 'issued' && <ModalGemHeader gem={gem} />}

      {step === 'compose' && (
        <>
          <Field
            label="Recipient email"
            type="email"
            inputMode="email"
            autoComplete="off"
            spellCheck={false}
            placeholder="them@example.com"
            value={recipientEmail}
            onChange={(event) => setRecipientEmail(event.target.value)}
            error={
              recipientEmail.trim() && !emailValid ? 'Enter a valid email address.' : undefined
            }
          />
          <p className="-mt-2 text-[11.5px] leading-relaxed text-ink-dim">
            Only this address can claim the card. It is what makes the printed code safe to hand
            over — without it, anyone who photographs the card takes the gemstone.
          </p>

          <Field
            label="Recipient name (optional)"
            placeholder="Printed on the card"
            value={recipientName}
            onChange={(event) => setRecipientName(event.target.value)}
          />

          <Labeled label="Message (optional)" hint={`${message.length}/${MAX_MESSAGE}`}>
            <textarea
              rows={3}
              maxLength={MAX_MESSAGE}
              className={cn(inputClass, 'h-auto resize-none py-2.5')}
              placeholder="A few words to go with it"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </Labeled>

          <Labeled label="Card design">
            <div className="grid grid-cols-3 gap-2">
              {GIFT_TEMPLATES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTemplate(option)}
                  aria-pressed={template === option}
                  className={cn(
                    'dc-btn-anim rounded-[4px] border px-3 py-2 text-[12.5px] transition-colors',
                    template === option
                      ? 'border-atelier/60 bg-atelier/[0.08] text-ink'
                      : 'border-line/[0.1] text-ink-muted hover:border-line/[0.2] hover:text-ink',
                  )}
                >
                  {templateLabel(option)}
                </button>
              ))}
            </div>
          </Labeled>

          <div className="grid grid-cols-[auto_1fr] gap-2.5">
            <Button variant="ghost" onClick={onBack}>
              Back
            </Button>
            <Button block disabled={!emailValid} onClick={() => setStep('approve')}>
              Continue
            </Button>
          </div>
        </>
      )}

      {step === 'approve' && (
        <>
          <div className="rounded-[4px] border border-line/[0.08] bg-panel p-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
              One signature
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-muted">
              You are approving Digital Carat to move{' '}
              <strong className="text-ink">this token only</strong>, once, when{' '}
              {recipientName.trim() || email} claims the card. The token stays in your wallet until
              then, and an unclaimed card simply expires — nothing is taken from you.
            </p>
          </div>
          <p className="text-[11.5px] leading-relaxed text-ink-dim">
            If you change your mind, cancel the card from your portfolio. Cancelling stops the claim
            immediately; clearing the approval itself is a second, unhurried step from the same
            place.
          </p>
          {error && <p className="text-[12px] text-ruby">{error}</p>}
          <div className="grid grid-cols-[auto_1fr] gap-2.5">
            <Button variant="ghost" disabled={issuing} onClick={() => setStep('compose')}>
              Back
            </Button>
            <TxButton
              block
              disabled={issuing}
              action={() =>
                dataService.approveTransfer({
                  tokenId: gem.tokenId!,
                  operator: giftOperatorAddress!,
                })
              }
              pendingLabel="Approving…"
              telemetryFlow="gift_approve"
              doneLabel={issuing ? 'Issuing card…' : 'Create the card'}
              onDone={issue}
            >
              Approve and continue
            </TxButton>
          </div>
        </>
      )}

      {step === 'issued' && issued && (
        <IssuedCard
          gem={gem}
          card={issued}
          template={template}
          recipientName={recipientName}
          message={message}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function IssuedCard({
  gem,
  card,
  template,
  recipientName,
  message,
  onClose,
}: {
  gem: DecoratedGem;
  card: CreatedGiftCard;
  template: GiftTemplate;
  recipientName: string;
  message: string;
  onClose: () => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [imageHref, setImageHref] = useState<string>();
  const [notice, setNotice] = useState<string>();
  // Read once on mount rather than on every render: the clock is impure, and a
  // countdown that shifts as the component re-renders is worse than one fixed
  // at the moment the card was issued.
  const [issuedAt] = useState(() => Date.now());
  const [emailState, setEmailState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [canvaState, setCanvaState] = useState<'idle' | 'working'>('idle');

  /*
   * Two outcomes worth distinguishing. A first-time sender has no Canva grant
   * yet, and the export answers 409 rather than failing — so they are sent to
   * authorise and land back here, rather than being shown an error for
   * something that is simply a step they have not taken.
   */
  async function openInCanva() {
    const element = svg();
    if (!element) return;
    setCanvaState('working');
    setNotice(undefined);
    try {
      const design = await exportCardToCanva({
        pngBase64: await cardAsPngBase64(element),
        title: `Digital Carat gift card — ${gem.name}`,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
      });
      window.open(design.editUrl, '_blank', 'noopener');
      setNotice('Opened in Canva. Your card is now in your Canva projects.');
    } catch (canvaError) {
      if (needsCanvaConnection(canvaError)) {
        try {
          window.location.href = await startCanvaAuthorization(window.location.pathname);
          return;
        } catch (authError) {
          setNotice(authError instanceof Error ? authError.message : 'Could not reach Canva.');
        }
      } else {
        setNotice(
          canvaError instanceof Error ? canvaError.message : 'Could not send the card to Canva.',
        );
      }
    } finally {
      setCanvaState('idle');
    }
  }

  async function email() {
    setEmailState('sending');
    setNotice(undefined);
    try {
      const { to } = await emailGiftCard(card.code);
      setEmailState('sent');
      setNotice(`Card sent to ${to}.`);
    } catch (sendError) {
      setEmailState('idle');
      setNotice(sendError instanceof Error ? sendError.message : 'The card could not be emailed.');
    }
  }

  const claimUrl = giftClaimUrl(card.code);
  const expires = new Date(card.expiresAt);
  const expiresLabel = `Claim by ${expires.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })}`;
  /*
   * Not chosen here, and not chosen by the protocol: it is the end of this
   * stone's reserve escrow term, recorded by the custodian at intake. Which
   * means it can be soon, and the sender has no way to know that until now — so
   * say it rather than let them post a card that lapses in a fortnight.
   */
  const daysLeft = Math.ceil((expires.getTime() - issuedAt) / 86_400_000);

  /*
   * Inlined before any export is attempted. A gateway image drawn straight into
   * the canvas taints it and `toBlob` throws, so the card would preview
   * correctly and then fail only at the moment the sender tried to save it.
   */
  useEffect(() => {
    let cancelled = false;
    inlineImage(gem.image).then((href) => {
      if (!cancelled) setImageHref(href);
    });
    return () => {
      cancelled = true;
    };
  }, [gem.image]);

  const svg = () => holder.current?.querySelector('svg') ?? null;
  const filename = `digital-carat-gift-${gem.displayId.replace(/[^A-Za-z0-9]+/g, '-')}`;

  async function run(action: () => void | Promise<void>, failure: string) {
    try {
      await action();
      setNotice(undefined);
    } catch {
      setNotice(failure);
    }
  }

  return (
    <>
      <div
        ref={holder}
        className="overflow-hidden rounded-[4px] border border-line/[0.1]"
        style={{ aspectRatio: `${CARD_WIDTH} / ${CARD_HEIGHT}` }}
      >
        <GiftCardArt
          template={template}
          gemName={gem.name}
          displayId={gem.displayId}
          variety={gem.typeLabel}
          caratsFmt={gem.caratsFmt}
          custody={gem.custodyCountry}
          valueFmt={gem.valueFmt}
          recipientName={recipientName.trim() || undefined}
          message={message.trim() || undefined}
          displayCode={card.displayCode}
          claimUrl={claimUrl}
          expiresLabel={expiresLabel}
          imageHref={imageHref}
        />
      </div>

      <div className="rounded-[4px] border border-amber/25 bg-amber/[0.06] p-3">
        <p className="text-[11.5px] leading-relaxed text-ink-muted">
          Save or print this now. The code is stored hashed and cannot be shown again — if you lose
          it, cancel the card from your portfolio and issue a new one.
        </p>
      </div>

      <p className="text-[11.5px] leading-relaxed text-ink-dim">
        Claimable until {expires.toLocaleDateString()} — the end of this gemstone&apos;s reserve
        escrow term, not a period we chose.{' '}
        {daysLeft <= 30 && (
          <span className="text-amber">
            That is only {daysLeft} {daysLeft === 1 ? 'day' : 'days'} away. Make sure the recipient
            can claim in time.
          </span>
        )}
      </p>

      <div className="grid gap-2 sm:grid-cols-3">
        <Button
          variant="secondary"
          onClick={() => {
            const element = svg();
            if (element && !printCard(element, `Digital Carat — ${gem.name}`)) {
              setNotice('Your browser blocked the print window. Allow pop-ups and try again.');
            }
          }}
        >
          Print
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            run(() => {
              const element = svg();
              return element ? downloadCardPng(element, `${filename}.png`) : undefined;
            }, 'The card could not be saved as a PNG.')
          }
        >
          Download PNG
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            run(() => {
              const element = svg();
              if (element) downloadCardSvg(element, `${filename}.svg`);
            }, 'The card could not be saved as an SVG.')
          }
        >
          Download SVG
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Button
          variant="ghost"
          onClick={() =>
            run(
              () => navigator.clipboard.writeText(claimUrl),
              'Copying failed — select the link below instead.',
            )
          }
        >
          Copy claim link
        </Button>
        {/*
          Sent by the server, not handed to a `mailto:` link. A machine with no
          default mail client swallows a `mailto:` entirely — no window, no
          error — so the sender is left believing a card went out that never did.
        */}
        <Button variant="ghost" disabled={emailState === 'sending'} onClick={() => void email()}>
          {emailState === 'sending'
            ? 'Sending…'
            : emailState === 'sent'
              ? 'Email sent ✓'
              : 'Email the recipient'}
        </Button>
        <a
          className="dc-btn-anim inline-flex h-11 items-center justify-center rounded-[4px] border border-line/[0.08] px-5 text-[13.5px] font-medium text-ink-faint hover:border-line/[0.16] hover:text-ink"
          href={`https://wa.me/?text=${encodeURIComponent(`${claimUrl}\n\nCode: ${card.displayCode}`)}`}
          target="_blank"
          rel="noreferrer"
        >
          Send by WhatsApp
        </a>
      </div>

      <Button
        variant="ghost"
        disabled={canvaState === 'working'}
        onClick={() => void openInCanva()}
      >
        {canvaState === 'working' ? 'Sending to Canva…' : 'Customise in Canva'}
      </Button>

      <p className="break-all font-mono text-[11px] text-ink-dim">{claimUrl}</p>
      {notice && <p className="text-[12px] text-ruby">{notice}</p>}

      <Button block onClick={onClose}>
        Done
      </Button>
    </>
  );
}
