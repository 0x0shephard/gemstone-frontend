import { useCallback, useEffect, useRef, useState } from 'react';
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
import {
  clearGiftPreparationIntent,
  clearGiftHandoff,
  inspectGiftPreparationIntent,
  inspectGiftHandoff,
  saveGiftPreparationIntent,
  saveGiftHandoff,
} from '@/services/offchain/giftHandoff';
import { dataService } from '@/services';
import {
  cancelGiftCard,
  confirmGiftCardEscrow,
  createGiftPreparationKey,
  createGiftCard,
  emailGiftCard,
  giftClaimUrl,
  resendGiftSenderCopy,
  type CreatedGiftCard,
  type SenderCopyOutcome,
} from '@/services/offchain/gift';
import { EdgeFunctionOutcomeUnknownError } from '@/services/offchain/invoke';
import { zeroHash, type Hash } from 'viem';
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
import { useAuth } from '@/providers/AuthProvider';
import { env } from '@/config/env';

type Step = 'compose' | 'escrow' | 'issued';

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
 * Three steps, in an order that matters. A pending email-bound record is made
 * first, the sender transfers the NFT into the server-declared escrow wallet,
 * and the card becomes claimable only after the server verifies escrow custody.
 */
export function GiftCardComposer({ gem, open, onClose, onBack }: GiftCardComposerProps) {
  const { linkedWallet } = useAuth();
  const account = linkedWallet ?? '';
  /*
   * A card that survived the Canva redirect, if there was one.
   *
   * Connecting Canva replaces the whole document, and the card's one-time code
   * exists nowhere else — the server keeps only its hash. Losing it left a valid
   * card nobody could ever claim, so it is parked before leaving and reclaimed
   * here on the way back.
   *
   * Read exactly once: taking it clears it, and calling this from each state
   * initialiser separately would hand the card to the first and nothing to the
   * rest.
   */
  const [restored] = useState(() =>
    account
      ? inspectGiftHandoff({ chainId: env.chainId, account, gemId: String(gem.gemId) })
      : undefined,
  );
  const [pendingPreparation] = useState(() =>
    account
      ? inspectGiftPreparationIntent({
          chainId: env.chainId,
          account,
          gemId: String(gem.gemId),
        })
      : undefined,
  );
  const [step, setStep] = useState<Step>(
    restored ? (restored.card.escrowed ? 'issued' : 'escrow') : 'compose',
  );
  const [recipientEmail, setRecipientEmail] = useState(
    restored?.recipientEmail ?? pendingPreparation?.payload.recipientEmail ?? '',
  );
  const [recipientName, setRecipientName] = useState(
    restored?.recipientName ?? pendingPreparation?.payload.recipientName ?? '',
  );
  const [message, setMessage] = useState(
    restored?.message ?? pendingPreparation?.payload.message ?? '',
  );
  const [template, setTemplate] = useState<GiftTemplate>(
    (restored?.template as GiftTemplate | undefined) ??
      (pendingPreparation?.payload.template as GiftTemplate | undefined) ??
      'classic',
  );
  const [issued, setIssued] = useState<CreatedGiftCard | null>(restored?.card ?? null);
  const [escrowTxHash, setEscrowTxHash] = useState<Hash | undefined>(restored?.escrowTxHash);
  const [error, setError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const recoveryStarted = useRef(false);
  const preparationRecoveryStarted = useRef(false);

  const handoffScope = issued
    ? { chainId: env.chainId, account, giftId: issued.giftId }
    : { chainId: env.chainId, account, gemId: String(gem.gemId) };

  const email = recipientEmail.trim().toLowerCase();
  const emailValid = EMAIL_PATTERN.test(email);

  const persist = useCallback(
    (card: CreatedGiftCard, hash?: Hash) => {
      if (!account) return;
      saveGiftHandoff({
        chainId: env.chainId,
        account,
        gemId: String(gem.gemId),
        card,
        recipientEmail: email,
        recipientName,
        message,
        template,
        escrowTxHash: hash,
      });
    },
    [account, email, gem.gemId, message, recipientName, template],
  );

  const prepare = useCallback(async () => {
    if (issuing) return;
    setIssuing(true);
    setError(null);
    const preparationScope = {
      chainId: env.chainId,
      account,
      gemId: String(gem.gemId),
    };
    const payload = {
      tokenId: gem.tokenId!.toString(),
      recipientEmail: email,
      recipientName: recipientName.trim(),
      message: message.trim(),
      template,
    };
    const existing = inspectGiftPreparationIntent(preparationScope);
    const preparation = existing ?? createGiftPreparationKey();
    const requestPayload = existing?.payload ?? payload;
    // Persist the stable request id and one-time code before the first edge
    // call. A timeout or reload can then reconcile the same server row rather
    // than rotating the only usable claim secret.
    if (!existing) saveGiftPreparationIntent({ ...preparationScope, payload, ...preparation });
    try {
      const card = await createGiftCard(
        {
          tokenId: BigInt(requestPayload.tokenId),
          recipientEmail: requestPayload.recipientEmail,
          recipientName: requestPayload.recipientName || undefined,
          message: requestPayload.message || undefined,
          template: requestPayload.template as GiftTemplate,
        },
        preparation,
      );
      clearGiftPreparationIntent(preparationScope);
      setIssued(card);
      persist(card);
      setStep('escrow');
    } catch (prepareError) {
      // Only an unknown outcome may have created the server row, so only that
      // keeps the stored key for reconciliation. A definite rejection leaves
      // nothing to reconcile; keeping the key would replay the rejected
      // request on every attempt and ignore whatever the sender changed.
      if (!(prepareError instanceof EdgeFunctionOutcomeUnknownError)) {
        clearGiftPreparationIntent(preparationScope);
      }
      setError(prepareError instanceof Error ? prepareError.message : 'Could not prepare the gift');
    } finally {
      setIssuing(false);
    }
  }, [account, email, gem.gemId, gem.tokenId, issuing, message, persist, recipientName, template]);

  useEffect(() => {
    if (
      !open ||
      restored ||
      !pendingPreparation ||
      step !== 'compose' ||
      preparationRecoveryStarted.current
    ) {
      return;
    }
    preparationRecoveryStarted.current = true;
    void prepare();
  }, [open, pendingPreparation, prepare, restored, step]);

  async function finalize(escrowTxHash: Hash) {
    if (!issued || issuing) return;
    setIssuing(true);
    setError(null);
    try {
      const card = await confirmGiftCardEscrow(issued, escrowTxHash);
      setIssued(card);
      // Activation does not make the one-time code recoverable from the
      // server. Keep the scoped session copy through the issued screen and
      // remove it only when the sender explicitly finishes with the card.
      persist(card, escrowTxHash);
      setStep('issued');
    } catch (confirmError) {
      setError(
        confirmError instanceof Error ? confirmError.message : 'Could not confirm gift escrow',
      );
      persist(issued, escrowTxHash);
    } finally {
      setIssuing(false);
    }
  }

  /*
   * If a phone suspended the browser after MetaMask completed the transfer,
   * recover by proving current escrow ownership. The server accepts ownership
   * as proof, so no second wallet transaction is needed.
   */
  useEffect(() => {
    if (
      !restored ||
      restored.awaitingTransfer ||
      step !== 'escrow' ||
      !issued ||
      recoveryStarted.current
    ) {
      return;
    }
    recoveryStarted.current = true;
    let cancelled = false;
    void confirmGiftCardEscrow(issued, escrowTxHash ?? zeroHash)
      .then((card) => {
        if (cancelled) return;
        setIssued(card);
        persist(card, escrowTxHash);
        setStep('issued');
      })
      .catch((recoveryError: unknown) => {
        if (cancelled) return;
        setError(
          recoveryError instanceof Error
            ? recoveryError.message
            : 'Gift activation still needs attention.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [escrowTxHash, issued, persist, restored, step]);

  async function abandonPreparedGift() {
    if (!issued || issuing) return;
    setIssuing(true);
    setError(null);
    try {
      await cancelGiftCard(issued.giftId);
      clearGiftHandoff(handoffScope);
      setIssued(null);
      setStep('compose');
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Could not cancel gift setup');
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
          ? 'Print it, or send the link. The escrowed gemstone is claimable once.'
          : 'The gemstone stays in escrow until the invited recipient verifies their account and wallet.'
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

          {/* Without this, a rejected preparation just reset the button. */}
          {error && (
            <p role="alert" className="text-[12px] text-ruby">
              {error}
            </p>
          )}
          <div className="grid grid-cols-[auto_1fr] gap-2.5">
            <Button variant="ghost" onClick={onBack}>
              Back
            </Button>
            <Button block disabled={!emailValid || issuing} onClick={() => void prepare()}>
              {issuing ? 'Preparing…' : 'Continue with gift card'}
            </Button>
          </div>
        </>
      )}

      {step === 'escrow' && issued && (
        <>
          <div className="rounded-[4px] border border-line/[0.08] bg-panel p-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
              Secure in escrow
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-muted">
              Your wallet will transfer <strong className="text-ink">this token only</strong> into
              Digital Carat escrow. It stays there until {recipientName.trim() || email} signs in
              with the invited email and connects a verified wallet.
            </p>
          </div>
          <p className="text-[11.5px] leading-relaxed text-ink-dim">
            You can cancel an unclaimed gift from your portfolio. Cancellation returns the token
            from escrow to your verified wallet.
          </p>
          {error && <p className="text-[12px] text-ruby">{error}</p>}
          <div className="grid grid-cols-[auto_1fr] gap-2.5">
            <Button variant="ghost" disabled={issuing} onClick={() => void abandonPreparedGift()}>
              Cancel setup
            </Button>
            {escrowTxHash ? (
              <Button block disabled={issuing} onClick={() => void finalize(escrowTxHash)}>
                {issuing ? 'Confirming escrow…' : 'Retry gift activation'}
              </Button>
            ) : (
              <TxButton
                block
                disabled={issuing}
                action={() =>
                  dataService.transferToken({
                    tokenId: gem.tokenId!,
                    to: issued.escrowWallet,
                  })
                }
                pendingLabel="Moving into escrow…"
                telemetryFlow="gift_escrow"
                doneLabel={issuing ? 'Confirming escrow…' : 'Finish gift card'}
                onConfirmed={(result) => {
                  setEscrowTxHash(result.hash);
                  // Store the chain fact before the activation request. If the
                  // tab closes or the request times out, no second transfer is
                  // offered and the card can be reconciled on the next mount.
                  persist(issued, result.hash);
                  return finalize(result.hash);
                }}
              >
                Transfer to escrow
              </TxButton>
            )}
          </div>
        </>
      )}

      {step === 'issued' && issued && (
        <IssuedCard
          gem={gem}
          card={issued}
          template={template}
          recipientEmail={email}
          recipientName={recipientName}
          message={message}
          account={account}
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
  recipientEmail,
  recipientName,
  message,
  account,
  onClose,
}: {
  gem: DecoratedGem;
  card: CreatedGiftCard;
  template: GiftTemplate;
  recipientEmail: string;
  recipientName: string;
  message: string;
  account: string;
  onClose: () => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [imageHref, setImageHref] = useState<string>();
  const [notice, setNotice] = useState<string>();
  // Read once on mount rather than on every render: the clock is impure, and a
  // countdown that shifts as the component re-renders is worse than one fixed
  // at the moment the card was issued.
  const [issuedAt] = useState(() => Date.now());
  // Activation now emails the recipient itself; this reflects that result.
  const [emailState, setEmailState] = useState<'idle' | 'sending' | 'sent'>(
    card.recipientEmail?.status === 'sent' ? 'sent' : 'idle',
  );
  const [senderCopy, setSenderCopy] = useState<SenderCopyOutcome | undefined>(card.senderCopy);
  const [resendingCopy, setResendingCopy] = useState(false);
  const [canvaState, setCanvaState] = useState<'idle' | 'working'>('idle');
  // Set only when the browser refused the tab, so the link can be offered.
  const [canvaLink, setCanvaLink] = useState<string>();

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

    /*
     * The tab is opened now, while the tap is still what is running.
     *
     * Rasterising the card and calling Canva both take a moment, and a phone
     * treats a `window.open` after that as unrequested and blocks it — which the
     * old code then reported as success, so a card that never opened anywhere
     * was announced as opened. Claiming the tab up front and pointing it
     * somewhere once the URL exists keeps the gesture intact.
     *
     * `noopener` cannot be passed here: it makes `open` return null, and the
     * handle is the entire point. The reference is severed below instead.
     */
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;

    try {
      const design = await exportCardToCanva({
        pngBase64: await cardAsPngBase64(element),
        title: `Digital Carat gift card — ${gem.name}`,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
      });
      if (tab) {
        tab.location.href = design.editUrl;
        setNotice('Opened in Canva. Your card is now in your Canva projects.');
      } else {
        // Blocked. Say so, and hand over the link rather than pretending.
        setCanvaLink(design.editUrl);
        setNotice(
          'Your browser blocked the new tab. Use the link below to open the card in Canva.',
        );
      }
    } catch (canvaError) {
      if (needsCanvaConnection(canvaError)) {
        try {
          /*
           * Parked before the document is replaced. The code is shown once and
           * stored only as a hash, so without this the redirect destroyed the
           * only copy in existence and left a live card nobody could claim.
           */
          saveGiftHandoff({
            chainId: env.chainId,
            account,
            gemId: String(gem.gemId),
            card,
            recipientEmail,
            recipientName,
            message,
            template,
          });
          tab?.close();
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

  async function resendCopy() {
    setResendingCopy(true);
    try {
      setSenderCopy(await resendGiftSenderCopy(card));
    } catch (copyError) {
      setSenderCopy({
        status: 'failed',
        reason: copyError instanceof Error ? copyError.message : 'The copy could not be emailed.',
      });
    } finally {
      setResendingCopy(false);
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
          {senderCopy?.status === 'sent'
            ? 'A printable QR copy was emailed to your account.'
            : senderCopy
              ? `Your printable copy was not emailed: ${senderCopy.reason}`
              : 'Your printable copy has not been emailed yet.'}{' '}
          Save or print this version now as well. The code is stored hashed and cannot be recovered
          later.
        </p>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-muted">
          {card.recipientEmail?.status === 'sent'
            ? `The claim link was emailed to ${recipientEmail}.`
            : card.recipientEmail
              ? `The recipient was not emailed: ${card.recipientEmail.reason} Use Email the recipient below.`
              : `Use Email the recipient below to send ${recipientEmail} the claim link.`}
        </p>
        {senderCopy?.status !== 'sent' && senderCopy?.status !== 'unavailable' && (
          <Button
            variant="ghost"
            className="mt-2"
            disabled={resendingCopy}
            onClick={() => void resendCopy()}
          >
            {resendingCopy ? 'Emailing your copy…' : 'Email my copy'}
          </Button>
        )}
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
              ? 'Email again'
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
      {/* Only present when the tab was blocked, so the card is still reachable. */}
      {canvaLink && (
        <a
          href={canvaLink}
          target="_blank"
          rel="noreferrer"
          className="text-[12px] font-semibold text-ink underline underline-offset-2"
        >
          Open the card in Canva
        </a>
      )}

      <Button
        block
        onClick={() => {
          clearGiftHandoff({ chainId: env.chainId, account, giftId: card.giftId });
          onClose();
        }}
      >
        Done
      </Button>
    </>
  );
}
