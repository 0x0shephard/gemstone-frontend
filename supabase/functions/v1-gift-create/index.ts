import { getAddress, isAddress, parseEventLogs, type Address, type Hash } from 'npm:viem@2';
import qrcode from 'npm:qrcode-generator@1.5.2';
import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import { dgeNftAbi, dgeNftAddress, operatorChain } from '../_shared/chain.ts';
import { canonicalSiteOrigin } from '../_shared/origins.ts';
import { emailConfigured, escapeHtml, sendEmail } from '../_shared/email.ts';
import { formatGiftCode, hashGiftCode, normalizeGiftCode } from '../_shared/gift.ts';

/**
 * Prepares and activates an email-bound escrow gift.
 *
 * `prepare` writes the recoverable off-chain record before the sender moves the
 * NFT. The browser then transfers the token to the operator wallet and calls
 * `confirm`; only a chain read proving escrow custody can make the card active.
 * A closed tab can therefore leave a cancellable pending record, never an
 * unexplained operator-held token.
 */

const MAX_MESSAGE = 500;
const TEMPLATES = new Set(['classic', 'noir', 'celebration']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TX_HASH = /^0x[0-9a-f]{64}$/i;

interface GiftRow {
  id: string;
  token_id: string;
  gem_id: string;
  code_hash: string;
  status: string;
  custody_mode: string;
  escrow_wallet: string;
  expires_at: string;
  sender_wallet: string;
  recipient_email: string;
  recipient_name: string | null;
  message: string | null;
  template: string;
  client_request_id: string | null;
}

const SELECT =
  'id,token_id::text,gem_id::text,code_hash,status,custody_mode,escrow_wallet,expires_at,sender_wallet,recipient_email,recipient_name,message,template,client_request_id';

function utf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  return btoa(binary);
}

function printableSenderCopy(card: GiftRow, code: string, senderName: string) {
  const claimUrl = `${canonicalSiteOrigin()}/gift/${code}`;
  const displayCode = formatGiftCode(code);
  const qr = qrcode(0, 'Q');
  qr.addData(claimUrl);
  qr.make();
  const qrSvg = qr.createSvgTag({ cellSize: 6, margin: 24, scalable: true });
  const recipient = card.recipient_name || card.recipient_email;
  const note = card.message?.trim();
  const expires = new Date(card.expires_at).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const printable = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Digital Carat gift card</title><style>@page{size:A5 landscape;margin:0}*{box-sizing:border-box}body{margin:0;background:#f4f1ea;color:#14161a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.card{width:210mm;min-height:148mm;margin:auto;padding:16mm;border:1px solid #d8ccb7;background:#fffdf8}.brand{font-size:11px;letter-spacing:4px;color:#8a7550}.grid{display:grid;grid-template-columns:1fr 58mm;gap:14mm;align-items:center;margin-top:14mm}h1{font-size:28px;margin:0 0 8px}.stone{font-size:18px;margin:0 0 22px}.note{padding-left:12px;border-left:2px solid #8a7550;font-style:italic}.qr svg{width:52mm;height:52mm}.code{font:16px ui-monospace,Menlo,monospace;letter-spacing:2px;text-align:center}.small{font-size:12px;color:#6b6455;line-height:1.5}@media print{body{background:#fff}.card{border:0}}</style></head><body><main class="card"><div class="brand">DIGITAL CARAT · GIFT CARD</div><div class="grid"><section><h1>For ${escapeHtml(recipient)}</h1><p class="stone">Gemstone ${escapeHtml(`#${card.gem_id}`)} · Token ${escapeHtml(`#${card.token_id}`)}</p>${note ? `<p class="note">${escapeHtml(note)}</p>` : ''}<p class="small">Sent by ${escapeHtml(senderName)}. Scan the QR or enter the code to claim. Claim by ${escapeHtml(expires)}.</p><p class="small">${escapeHtml(claimUrl)}</p></section><section class="qr">${qrSvg}<div class="code">${escapeHtml(displayCode)}</div></section></div></main></body></html>`;
  return { claimUrl, displayCode, printable };
}

/** Enough to recover from a bounced or filtered copy; not a mail cannon. */
const MAX_SENDER_COPIES_PER_DAY = 5;

/**
 * What happened to the sender's printable copy.
 *
 * This used to be fire-and-forget: a Resend rejection was only a console line,
 * while the issued screen told the sender a copy "is being emailed". Returning
 * the outcome lets the screen tell the truth and offer a resend.
 */
type SenderCopyOutcome =
  | { status: 'sent' }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; reason: string };

async function sendSenderCopy(
  user: { id: string; email?: string | null },
  admin: ReturnType<typeof adminClient>,
  card: GiftRow,
  code: string,
  { force = false }: { force?: boolean } = {},
): Promise<SenderCopyOutcome> {
  if (!emailConfigured()) {
    return { status: 'unavailable', reason: 'Email delivery is not configured yet.' };
  }
  if (!user.email) {
    return { status: 'unavailable', reason: 'Your account has no email address to send to.' };
  }
  if (!force) {
    const { data: existingDelivery } = await admin
      .from('audit_records')
      .select('id')
      .eq('entity_type', 'gift_card')
      .eq('entity_id', card.id)
      .eq('action', 'gift.sender_copy_sent')
      .limit(1)
      .maybeSingle();
    if (existingDelivery) return { status: 'sent' };
  }
  const { data: profile } = await admin
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .maybeSingle();
  const senderName = (profile?.full_name as string | null) || 'Digital Carat collector';
  const { claimUrl, displayCode, printable } = printableSenderCopy(card, code, senderName);
  const messageId = await sendEmail({
    to: user.email,
    subject: `Your printable Digital Carat gift card for gemstone #${card.gem_id}`,
    html: `<p>Your gift card is ready.</p><p>A print-ready card with its QR code is attached. You can print it or forward this email to ${escapeHtml(card.recipient_email)}.</p><p><a href="${escapeHtml(claimUrl)}">Open the claim page</a><br>Code: <strong>${escapeHtml(displayCode)}</strong></p>`,
    text: `Your gift card is ready. A print-ready card with its QR code is attached.\n\nClaim page: ${claimUrl}\nCode: ${displayCode}`,
    attachments: [
      {
        filename: `digital-carat-gift-${card.gem_id}.html`,
        content: utf8Base64(printable),
      },
    ],
  });
  await audit(user.id, 'gift.sender_copy_sent', 'gift_card', card.id, { messageId });
  return { status: 'sent' };
}

/**
 * Sends the copy without letting a mail failure undo an activation that has
 * already happened on chain and in the database.
 */
async function deliverSenderCopy(
  user: { id: string; email?: string | null },
  admin: ReturnType<typeof adminClient>,
  card: GiftRow,
  code: string,
  options?: { force?: boolean },
): Promise<SenderCopyOutcome> {
  try {
    return await sendSenderCopy(user, admin, card, code, options);
  } catch (error) {
    console.error('Could not email sender gift-card copy', error);
    return { status: 'failed', reason: safeErrorMessage(error, 'The copy could not be emailed.') };
  }
}

async function escrowTransferProven(
  chain: ReturnType<typeof operatorChain>,
  card: GiftRow,
  tokenId: bigint,
  escrowWallet: Address,
  escrowTxHash: string,
): Promise<boolean> {
  const nft = dgeNftAddress();
  const owner = await chain.logsClient
    .readContract({ address: nft, abi: dgeNftAbi, functionName: 'ownerOf', args: [tokenId] })
    .catch(() => null);
  if (owner && getAddress(owner) === escrowWallet) return true;
  if (!TX_HASH.test(escrowTxHash)) return false;
  const receipt = await chain.logsClient
    .getTransactionReceipt({ hash: escrowTxHash as Hash })
    .catch(() => null);
  if (!receipt || receipt.status !== 'success') return false;
  const transfers = parseEventLogs({
    abi: dgeNftAbi,
    logs: receipt.logs,
    eventName: 'Transfer',
    strict: false,
  });
  return transfers.some(
    (event) =>
      event.address.toLowerCase() === nft.toLowerCase() &&
      event.args.tokenId === tokenId &&
      getAddress(event.args.from) === getAddress(card.sender_wallet) &&
      getAddress(event.args.to) === escrowWallet,
  );
}

function giftResponse(card: GiftRow, code: string, escrowed: boolean) {
  return {
    giftId: card.id,
    code,
    displayCode: formatGiftCode(code),
    expiresAt: card.expires_at,
    tokenId: card.token_id,
    gemId: card.gem_id,
    escrowWallet: getAddress(card.escrow_wallet),
    escrowed,
  };
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const user = await requireUser(request);
    const admin = adminClient();
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? 'prepare');
    const chain = operatorChain();
    const nft = dgeNftAddress();
    const escrowWallet = getAddress(chain.account.address);

    /*
     * Preparing or confirming a gift does not submit an operator transaction.
     * The old path nevertheless ran the four-call seller-automation preflight
     * and then repeated NFT reads on the slower write RPC. On a cold mobile
     * request that could spend minutes retrying before the wallet step appeared.
     * Use the dedicated, fail-fast public read client and validate only the NFT
     * state this operation actually depends on.
     */

    if (action === 'confirm') {
      const giftId = String(body.giftId ?? '');
      const code = normalizeGiftCode(body.code);
      if (!UUID.test(giftId) || !code) return json({ error: 'That gift setup is not valid' }, 400);

      const { data } = await admin
        .from('gift_cards')
        .select(SELECT)
        .eq('id', giftId)
        .eq('sender_id', user.id)
        .eq('code_hash', await hashGiftCode(code))
        .maybeSingle();
      const card = data as GiftRow | null;
      if (!card || card.custody_mode !== 'operator_escrow') {
        return json({ error: 'That gift setup is not available' }, 404);
      }
      if (getAddress(card.escrow_wallet) !== escrowWallet) {
        return json({ error: 'The configured gift escrow wallet has changed' }, 409);
      }
      if (card.status === 'active') {
        const senderCopy = await deliverSenderCopy(user, admin, card, code);
        return json({ ...giftResponse(card, code, true), senderCopy });
      }
      if (card.status !== 'pending_escrow') {
        return json({ error: 'That gift setup is no longer pending' }, 409);
      }
      if (new Date(card.expires_at).getTime() <= Date.now()) {
        return json({ error: 'This gift setup expired before escrow was confirmed' }, 409);
      }

      const tokenId = BigInt(card.token_id);
      const locked = (await chain.logsClient.readContract({
        address: nft,
        abi: dgeNftAbi,
        functionName: 'transferLocked',
        args: [tokenId],
      })) as boolean;
      if (locked) return json({ error: 'This token became locked during gift setup' }, 409);
      const escrowTxHash = String(body.escrowTxHash ?? '');
      if (!(await escrowTransferProven(chain, card, tokenId, escrowWallet, escrowTxHash))) {
        return json({ error: 'Transfer the token into Digital Carat escrow first' }, 409);
      }

      const now = new Date().toISOString();
      const { data: activated } = await admin
        .from('gift_cards')
        .update({
          status: 'active',
          escrowed_at: now,
          escrow_tx_hash: TX_HASH.test(escrowTxHash) ? escrowTxHash.toLowerCase() : null,
        })
        .eq('id', card.id)
        .eq('status', 'pending_escrow')
        .select(SELECT)
        .maybeSingle();
      if (!activated) return json({ error: 'That gift setup was already completed' }, 409);

      await audit(user.id, 'gift.escrowed', 'gift_card', card.id, {
        tokenId: card.token_id,
        escrowWallet,
        transactionHash: TX_HASH.test(escrowTxHash) ? escrowTxHash : null,
      });
      const senderCopy = await deliverSenderCopy(user, admin, activated as GiftRow, code);
      return json({ ...giftResponse(activated as GiftRow, code, true), senderCopy });
    }

    /*
     * Finish a pending card from any tab or device.
     *
     * The one-time code is the only thing that can confirm a pending card, and it
     * lived solely in the preparing tab's session storage. A tab closed or
     * replaced during the MetaMask round trip therefore stranded the card even
     * when the token had already moved into escrow. A pending card is not
     * claimable, so its code has never been usable by anyone: the signed-in
     * sender may replace it with a fresh one (supplied by the client, so a lost
     * response can be retried with the same value) and continue, without a
     * second wallet transfer when custody is already proven.
     */
    if (action === 'resume') {
      const giftId = String(body.giftId ?? '');
      const code = normalizeGiftCode(body.code);
      if (!UUID.test(giftId) || !code) return json({ error: 'That gift setup is not valid' }, 400);
      const { data } = await admin
        .from('gift_cards')
        .select(SELECT)
        .eq('id', giftId)
        .eq('sender_id', user.id)
        .maybeSingle();
      const card = data as GiftRow | null;
      if (!card || card.custody_mode !== 'operator_escrow') {
        return json({ error: 'That gift setup is not available' }, 404);
      }
      if (card.status !== 'pending_escrow') {
        return json({ error: 'That gift setup is no longer pending' }, 409);
      }
      if (getAddress(card.escrow_wallet) !== escrowWallet) {
        return json({ error: 'The configured gift escrow wallet has changed' }, 409);
      }
      if (new Date(card.expires_at).getTime() <= Date.now()) {
        return json({ error: 'This gift setup has expired. Cancel it to release the token.' }, 409);
      }
      const owner = getAddress(
        (await chain.logsClient.readContract({
          address: nft,
          abi: dgeNftAbi,
          functionName: 'ownerOf',
          args: [BigInt(card.token_id)],
        })) as string,
      );
      const custody =
        owner === escrowWallet
          ? 'escrow'
          : owner === getAddress(card.sender_wallet)
            ? 'sender'
            : null;
      if (!custody) {
        return json(
          { error: 'This token has left your wallet, so the setup cannot continue. Cancel it.' },
          409,
        );
      }
      const { data: reissued } = await admin
        .from('gift_cards')
        .update({ code_hash: await hashGiftCode(code) })
        .eq('id', card.id)
        .eq('status', 'pending_escrow')
        .select(SELECT)
        .maybeSingle();
      if (!reissued) return json({ error: 'That gift setup is no longer pending' }, 409);
      await audit(user.id, 'gift.code_reissued', 'gift_card', card.id, {
        tokenId: card.token_id,
        custody,
      });
      return json({ ...giftResponse(reissued as GiftRow, code, false), custody });
    }

    if (action === 'sender_copy') {
      const giftId = String(body.giftId ?? '');
      const code = normalizeGiftCode(body.code);
      if (!UUID.test(giftId) || !code) return json({ error: 'That gift card is not valid' }, 400);
      const { data } = await admin
        .from('gift_cards')
        .select(SELECT)
        .eq('id', giftId)
        .eq('sender_id', user.id)
        .eq('code_hash', await hashGiftCode(code))
        .maybeSingle();
      const card = data as GiftRow | null;
      if (!card) return json({ error: 'That gift card is not yours to send' }, 404);
      if (card.status !== 'active') {
        return json({ error: 'Only an active gift card can be emailed' }, 409);
      }
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const { count } = await admin
        .from('audit_records')
        .select('id', { count: 'exact', head: true })
        .eq('entity_type', 'gift_card')
        .eq('entity_id', card.id)
        .eq('action', 'gift.sender_copy_sent')
        .gte('created_at', since);
      if ((count ?? 0) >= MAX_SENDER_COPIES_PER_DAY) {
        return json(
          { error: `Your copy has already been emailed ${MAX_SENDER_COPIES_PER_DAY} times today` },
          429,
        );
      }
      const senderCopy = await deliverSenderCopy(user, admin, card, code, { force: true });
      return json({ senderCopy });
    }

    if (action !== 'prepare') return json({ error: 'Unknown action' }, 400);

    const clientRequestId = String(body.clientRequestId ?? '');
    const suppliedCode = normalizeGiftCode(body.code);
    if (!UUID.test(clientRequestId) || !suppliedCode) {
      return json({ error: 'Gift preparation idempotency data is invalid' }, 400);
    }
    const suppliedHash = await hashGiftCode(suppliedCode);
    const { data: prior } = await admin
      .from('gift_cards')
      .select(SELECT)
      .eq('sender_id', user.id)
      .eq('client_request_id', clientRequestId)
      .maybeSingle();
    if (prior) {
      const priorCard = prior as GiftRow;
      if (priorCard.code_hash !== suppliedHash) {
        return json({ error: 'That gift preparation key was already used' }, 409);
      }
      return json(giftResponse(priorCard, suppliedCode, priorCard.status !== 'pending_escrow'));
    }

    const tokenIdRaw = String(body.tokenId ?? '').trim();
    if (!/^\d+$/.test(tokenIdRaw) || tokenIdRaw === '0') {
      return json({ error: 'A minted token id is required' }, 400);
    }
    const tokenId = BigInt(tokenIdRaw);
    const recipientEmail = String(body.recipientEmail ?? '')
      .trim()
      .toLowerCase();
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(recipientEmail)) {
      return json({ error: 'A valid recipient email address is required' }, 400);
    }
    if (recipientEmail === (user.email ?? '').toLowerCase()) {
      return json({ error: 'That is your own email address' }, 400);
    }
    const recipientName = String(body.recipientName ?? '').trim() || null;
    const message = String(body.message ?? '').trim();
    if (message.length > MAX_MESSAGE) {
      return json({ error: `Message must be ${MAX_MESSAGE} characters or fewer` }, 400);
    }
    const template = String(body.template ?? 'classic');
    if (!TEMPLATES.has(template)) return json({ error: 'Unknown card template' }, 400);

    const { data: walletLink } = await admin
      .from('wallet_links')
      .select('wallet_address')
      .eq('profile_id', user.id)
      .eq('is_primary', true)
      .not('verified_at', 'is', null)
      .maybeSingle();
    if (!walletLink?.wallet_address || !isAddress(walletLink.wallet_address)) {
      return json({ error: 'Verify a wallet with Sign-In with Ethereum first' }, 400);
    }
    const senderWallet = getAddress(walletLink.wallet_address);

    const [owner, locked, gemId] = (await Promise.all([
      chain.logsClient.readContract({
        address: nft,
        abi: dgeNftAbi,
        functionName: 'ownerOf',
        args: [tokenId],
      }),
      chain.logsClient.readContract({
        address: nft,
        abi: dgeNftAbi,
        functionName: 'transferLocked',
        args: [tokenId],
      }),
      chain.logsClient.readContract({
        address: nft,
        abi: dgeNftAbi,
        functionName: 'tokenGem',
        args: [tokenId],
      }),
    ])) as [string, boolean, bigint];
    if (getAddress(owner) !== senderWallet) {
      return json({ error: 'Your verified wallet does not hold this token' }, 403);
    }
    if (locked) {
      return json({ error: 'This token is locked while its redemption is in progress' }, 409);
    }

    /*
     * Latest recorded term, not `maybeSingle()` alone: a gem with more than one
     * dated submission row made PostgREST return an error, the error was
     * dropped, and the sender was told no date existed at all.
     */
    const { data: custody, error: custodyError } = await admin
      .from('seller_submissions')
      .select('reserve_escrow_ends_at')
      .eq('onchain_gem_id', gemId.toString())
      .not('reserve_escrow_ends_at', 'is', null)
      .order('reserve_escrow_ends_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (custodyError) throw custodyError;
    if (!custody?.reserve_escrow_ends_at) {
      return json(
        {
          error:
            'This gemstone has no recorded reserve escrow end date, so a gift card cannot be dated. Ask the custodian to record it.',
        },
        409,
      );
    }
    const expiresAt = new Date(custody.reserve_escrow_ends_at as string);
    if (expiresAt.getTime() <= Date.now()) {
      return json({ error: 'This gemstone’s reserve escrow has already ended' }, 409);
    }

    /*
     * Retire stale setups before claiming the token's one open slot.
     *
     * A `pending_escrow` row is only a preparation record, and it never expires
     * on its own. When the tab closed before the transfer (or the card was set
     * up by a previous owner), its one-time code was gone and every later setup
     * for this token hit the open-card unique index and answered 409 until
     * someone found Cancel in the portfolio. The ownership read above proves
     * the token is still in the sender's wallet, not escrow, so no pending row
     * for it can be backed by custody; replacing it loses nothing claimable.
     */
    const { data: superseded, error: supersedeError } = await admin
      .from('gift_cards')
      .update({ status: 'cancelled', returned_at: new Date().toISOString() })
      .eq('token_id', tokenId.toString())
      .eq('status', 'pending_escrow')
      .select('id');
    if (supersedeError) throw supersedeError;
    for (const stale of superseded ?? []) {
      await audit(user.id, 'gift.superseded', 'gift_card', stale.id as string, {
        tokenId: tokenId.toString(),
        holder: senderWallet,
      });
    }

    const code = suppliedCode;
    const { data: inserted, error } = await admin
      .from('gift_cards')
      .insert({
        sender_id: user.id,
        sender_wallet: senderWallet.toLowerCase(),
        token_id: tokenId.toString(),
        gem_id: gemId.toString(),
        code_hash: await hashGiftCode(code),
        client_request_id: clientRequestId,
        recipient_email: recipientEmail,
        recipient_name: recipientName,
        message: message || null,
        template,
        status: 'pending_escrow',
        custody_mode: 'operator_escrow',
        escrow_wallet: escrowWallet.toLowerCase(),
        expires_at: expiresAt.toISOString(),
      })
      .select(SELECT)
      .single();
    if (error) {
      if (error.code === '23505') {
        const { data: raced } = await admin
          .from('gift_cards')
          .select(SELECT)
          .eq('sender_id', user.id)
          .eq('client_request_id', clientRequestId)
          .maybeSingle();
        if (raced && (raced as GiftRow).code_hash === suppliedHash) {
          return json(giftResponse(raced as GiftRow, code, false));
        }
        return json(
          {
            error:
              'This token already has a live gift card, or one being claimed or cancelled. Finish or cancel it from your portfolio first.',
          },
          409,
        );
      }
      throw error;
    }

    await audit(user.id, 'gift.prepared', 'gift_card', inserted.id, {
      tokenId: tokenId.toString(),
      escrowWallet,
      expiresAt: expiresAt.toISOString(),
    });
    return json(giftResponse(inserted as GiftRow, code, false));
  } catch (error) {
    return json({ error: safeErrorMessage(error, 'Could not prepare the gift') }, 400);
  }
});
