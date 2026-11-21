import { getAddress, isAddress } from 'npm:viem@2';
import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import { assertOperatorChain, dgeNftAbi, dgeNftAddress, operatorChain } from '../_shared/chain.ts';
import { generateGiftCode, hashGiftCode } from '../_shared/gift.ts';
import { requireProtocolDeployment } from '../_shared/deployment.ts';
import { assertNoLegacySepoliaFallback } from '../_shared/legacySepoliaEnv.ts';
import { MissingCapabilityError, operationalMembership } from '../_shared/operations.ts';
import { claimWalletMismatch, normalizePromoCode, promoErrorMessage } from '../_shared/promo.ts';

/**
 * Promotional claims (FIRST100): one pooled token per new collector.
 *
 *   inspect  public    what the code offers and how many are left
 *   claim    signed in assign a token, then transfer it through v1-gift-claim
 *   admin_*  admins    create campaigns, pool tokens, open or close them
 *
 * A claim is turned into an ordinary operator-escrow gift card bound to the
 * claimant's email, and the transfer is delegated to `v1-gift-claim` with the
 * caller's own session. That function already reconciles a transfer that timed
 * out, retries a dropped nonce and serialises the operator wallet; doing it a
 * second way here would be a second set of those bugs.
 *
 * Gift codes are stored only as hashes, so a retried claim cannot recover the
 * original. Each call therefore issues a fresh code for the claimant's card and
 * swaps its hash; the claimant never sees it.
 */

const ADMIN_CAPABILITY = 'admin.correct';
const MAX_TOKENS_PER_CALL = 50;

type Admin = ReturnType<typeof adminClient>;

interface Campaign {
  id: string;
  code: string;
  title: string;
  message: string | null;
  max_claims: number;
  active: boolean;
  created_at: string;
}

async function campaignByCode(admin: Admin, deploymentId: string, code: string) {
  const { data, error } = await admin
    .from('promo_campaigns')
    .select('id,code,title,message,max_claims,active,created_at')
    .eq('deployment_id', deploymentId)
    .eq('code', code)
    .maybeSingle();
  if (error) throw error;
  return (data as Campaign | null) ?? null;
}

/** Pool size, claims, and the first unclaimed token's gem for a preview. */
async function campaignStats(admin: Admin, deploymentId: string, campaign: Campaign) {
  const [{ data: pool, error: poolError }, { data: claims, error: claimError }] = await Promise.all(
    [
      admin
        .from('promo_pool')
        .select('token_id::text,gem_id::text')
        .eq('deployment_id', deploymentId)
        .eq('campaign_id', campaign.id)
        .order('added_at'),
      admin
        .from('promo_claims')
        .select('token_id::text')
        .eq('deployment_id', deploymentId)
        .eq('campaign_id', campaign.id),
    ],
  );
  if (poolError) throw poolError;
  if (claimError) throw claimError;
  const claimed = new Set((claims ?? []).map((row) => String(row.token_id)));
  const unclaimed = (pool ?? []).filter((row) => !claimed.has(String(row.token_id)));
  const remaining = Math.max(0, Math.min(unclaimed.length, campaign.max_claims - claimed.size));
  return {
    pooled: (pool ?? []).length,
    claimed: claimed.size,
    remaining,
    sampleGemId: (unclaimed[0]?.gem_id as string | null | undefined) ?? null,
  };
}

function campaignState(campaign: Campaign, remaining: number) {
  if (!campaign.active) return 'closed' as const;
  return remaining > 0 ? ('open' as const) : ('sold_out' as const);
}

async function primaryWallet(admin: Admin, profileId: string) {
  const { data } = await admin
    .from('wallet_links')
    .select('wallet_address')
    .eq('profile_id', profileId)
    .eq('is_primary', true)
    .not('verified_at', 'is', null)
    .maybeSingle();
  const address = data?.wallet_address as string | undefined;
  return address && isAddress(address) ? getAddress(address) : null;
}

/** Hands the claim to v1-gift-claim with the caller's own session. */
async function forwardGiftClaim(request: Request, code: string): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const name of ['authorization', 'apikey', 'x-protocol-deployment', 'x-client-info']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has('apikey')) headers.set('apikey', Deno.env.get('SUPABASE_ANON_KEY') ?? '');
  const response = await fetch(
    `${Deno.env.get('SUPABASE_URL')!.replace(/\/$/, '')}/functions/v1/v1-gift-claim`,
    { method: 'POST', headers, body: JSON.stringify({ code, action: 'claim' }) },
  );
  const body = await response
    .json()
    .catch(() => ({ error: 'The transfer service did not answer' }));
  return json(body, response.status);
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const admin = adminClient();
    const deployment = await requireProtocolDeployment(admin, request);
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? 'inspect');

    if (action === 'inspect' || action === 'claim') {
      const code = normalizePromoCode(body.code);
      const campaign = code ? await campaignByCode(admin, deployment.id, code) : null;
      if (!campaign) return json({ error: 'That code is not valid' }, 404);
      const stats = await campaignStats(admin, deployment.id, campaign);
      const summary = {
        code: campaign.code,
        title: campaign.title,
        message: campaign.message,
        state: campaignState(campaign, stats.remaining),
        remaining: stats.remaining,
        sampleGemId: stats.sampleGemId,
      };
      if (action === 'inspect') return json(summary);

      const user = await requireUser(request);
      const email = user.email?.trim().toLowerCase();
      if (!email) return json({ error: 'Sign in with your email address first' }, 400);
      const wallet = await primaryWallet(admin, user.id);
      if (!wallet) return json({ error: 'Connect and verify a wallet to receive the token' }, 400);

      assertNoLegacySepoliaFallback();
      const chain = operatorChain();
      await assertOperatorChain(chain);
      const escrowWallet = getAddress(chain.account.address);

      // One stone per wallet covers the wallet a stone actually reached, not
      // only the one a claim recorded.
      const { data: reached } = await admin
        .from('promo_claims')
        .select('id,gift_cards!inner(claimed_wallet)')
        .eq('campaign_id', campaign.id)
        .eq('gift_cards.claimed_wallet', wallet.toLowerCase())
        .neq('profile_id', user.id)
        .limit(1);
      if (reached && reached.length > 0) {
        const known = promoErrorMessage('promo_already_claimed')!;
        return json({ error: known.message, state: known.state }, 409);
      }

      const giftCode = generateGiftCode();
      const codeHash = await hashGiftCode(giftCode);
      const { data: assigned, error: assignError } = await admin.rpc('assign_promo_token', {
        p_deployment_id: deployment.id,
        p_campaign_id: campaign.id,
        p_profile_id: user.id,
        p_email: email,
        p_wallet: wallet.toLowerCase(),
        p_code_hash: codeHash,
        p_escrow_wallet: escrowWallet.toLowerCase(),
      });
      if (assignError) {
        const known = promoErrorMessage(assignError.message);
        if (known) return json({ error: known.message, state: known.state }, 409);
        throw assignError;
      }
      const row = (Array.isArray(assigned) ? assigned[0] : assigned) as
        | {
            gift_card_id: string;
            token_id: string | number;
            gem_id: string | number | null;
            created: boolean;
          }
        | undefined;
      if (!row) throw new Error('No token was assigned');

      if (row.created) {
        await audit(user.id, 'promo.assigned', 'promo_campaign', campaign.id, {
          code: campaign.code,
          tokenId: String(row.token_id),
          giftCardId: row.gift_card_id,
        });
      } else {
        // A retry. The first call's code is unrecoverable, so issue a new one
        // for this same card. A finished claim is simply reported.
        const { data: card } = await admin
          .from('gift_cards')
          .select('status,claim_tx_hash,claimed_wallet')
          .eq('id', row.gift_card_id)
          .maybeSingle();
        if (card?.status === 'claimed') {
          return json({
            state: 'claimed',
            tokenId: String(row.token_id),
            gemId: row.gem_id === null ? null : String(row.gem_id),
            transactionHash: card.claim_tx_hash ?? undefined,
            recipientWallet: card.claimed_wallet ?? undefined,
          });
        }
        if (card?.status !== 'active' && card?.status !== 'claim_pending') {
          return json({ error: 'This claim was withdrawn. Contact Digital Carat support.' }, 409);
        }
        // An unfinished retry must still go to the wallet the claim recorded.
        const { data: claim } = await admin
          .from('promo_claims')
          .select('wallet')
          .eq('gift_card_id', row.gift_card_id)
          .maybeSingle();
        const mismatch = claimWalletMismatch(String(claim?.wallet ?? ''), wallet);
        if (mismatch) return json({ error: mismatch }, 409);
        const { error: rotateError } = await admin
          .from('gift_cards')
          .update({ code_hash: codeHash })
          .eq('id', row.gift_card_id)
          .in('status', ['active', 'claim_pending']);
        if (rotateError) throw rotateError;
      }

      return forwardGiftClaim(request, giftCode);
    }

    // Everything below is staff-only.
    const user = await requireUser(request);
    const membership = await operationalMembership(admin, user.id, ADMIN_CAPABILITY);

    if (action === 'admin_list') {
      const { data, error } = await admin
        .from('promo_campaigns')
        .select('id,code,title,message,max_claims,active,created_at')
        .eq('deployment_id', deployment.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const campaigns = await Promise.all(
        ((data ?? []) as Campaign[]).map(async (campaign) => {
          const stats = await campaignStats(admin, deployment.id, campaign);
          return { ...campaign, ...stats, state: campaignState(campaign, stats.remaining) };
        }),
      );
      const { data: pool } = await admin
        .from('promo_pool')
        .select('campaign_id,token_id::text,gem_id::text,added_at')
        .eq('deployment_id', deployment.id)
        .order('added_at');
      const { data: claims } = await admin
        .from('promo_claims')
        .select(
          'campaign_id,token_id::text,email,wallet,created_at,gift_cards(status,claim_tx_hash)',
        )
        .eq('deployment_id', deployment.id)
        .order('created_at', { ascending: false });
      return json({
        operatorWallet: getAddress(operatorChain().account.address),
        campaigns,
        pool: pool ?? [],
        claims: claims ?? [],
      });
    }

    if (action === 'admin_create') {
      const code = normalizePromoCode(body.code);
      if (!code) return json({ error: 'Codes are 4–32 letters and digits' }, 400);
      const title = String(body.title ?? '').trim();
      if (!title || title.length > 120)
        return json({ error: 'A title of up to 120 characters is required' }, 400);
      const message = String(body.message ?? '').trim() || null;
      if (message && message.length > 500)
        return json({ error: 'The message is limited to 500 characters' }, 400);
      const maxClaims = Number(body.maxClaims);
      if (!Number.isSafeInteger(maxClaims) || maxClaims < 1) {
        return json({ error: 'The claim limit must be a whole number above zero' }, 400);
      }
      const { data, error } = await admin
        .from('promo_campaigns')
        .insert({
          deployment_id: deployment.id,
          code,
          title,
          message,
          max_claims: maxClaims,
          created_by: user.id,
        })
        .select('id,code')
        .single();
      if (error) {
        if (error.code === '23505') return json({ error: 'That code is already in use' }, 409);
        throw error;
      }
      await audit(user.id, 'promo.created', 'promo_campaign', data.id, {
        code,
        maxClaims,
        organizationId: membership.organizationId,
      });
      return json({ campaign: data }, 201);
    }

    const campaignId = String(body.campaignId ?? '');
    const { data: campaign } = await admin
      .from('promo_campaigns')
      .select('id,code')
      .eq('deployment_id', deployment.id)
      .eq('id', campaignId)
      .maybeSingle();
    if (!campaign) return json({ error: 'Campaign not found' }, 404);

    if (action === 'admin_update') {
      const update: Record<string, unknown> = {};
      if (typeof body.active === 'boolean') update.active = body.active;
      if (body.maxClaims !== undefined) {
        const maxClaims = Number(body.maxClaims);
        if (!Number.isSafeInteger(maxClaims) || maxClaims < 1) {
          return json({ error: 'The claim limit must be a whole number above zero' }, 400);
        }
        update.max_claims = maxClaims;
      }
      if (Object.keys(update).length === 0) return json({ error: 'Nothing to change' }, 400);
      const { error } = await admin.from('promo_campaigns').update(update).eq('id', campaign.id);
      if (error) throw error;
      await audit(user.id, 'promo.updated', 'promo_campaign', campaign.id, update);
      return json({ ok: true });
    }

    if (action === 'admin_add_tokens') {
      const depositedFrom = String(body.depositedFrom ?? '');
      if (!isAddress(depositedFrom))
        return json({ error: 'The depositing wallet is not an address' }, 400);
      const rawIds = Array.isArray(body.tokenIds) ? body.tokenIds : [];
      const tokenIds = [...new Set(rawIds.map((value) => String(value).trim()))].filter((value) =>
        /^[1-9]\d{0,9}$/.test(value),
      );
      if (tokenIds.length === 0 || tokenIds.length > MAX_TOKENS_PER_CALL) {
        return json({ error: `Send between 1 and ${MAX_TOKENS_PER_CALL} token numbers` }, 400);
      }

      assertNoLegacySepoliaFallback();
      const chain = operatorChain();
      const operator = getAddress(chain.account.address);
      const nft = dgeNftAddress();
      const added: string[] = [];
      const refused: Array<{ tokenId: string; reason: string }> = [];
      for (const tokenId of tokenIds) {
        try {
          const id = BigInt(tokenId);
          const [owner, locked, gemId] = (await Promise.all([
            chain.publicClient.readContract({
              address: nft,
              abi: dgeNftAbi,
              functionName: 'ownerOf',
              args: [id],
            }),
            chain.publicClient.readContract({
              address: nft,
              abi: dgeNftAbi,
              functionName: 'transferLocked',
              args: [id],
            }),
            chain.publicClient.readContract({
              address: nft,
              abi: dgeNftAbi,
              functionName: 'tokenGem',
              args: [id],
            }),
          ])) as [string, boolean, bigint];
          if (getAddress(owner) !== operator) {
            refused.push({ tokenId, reason: 'not yet in the operator escrow wallet' });
            continue;
          }
          if (locked) {
            refused.push({ tokenId, reason: 'locked by a redemption' });
            continue;
          }
          const { data: openGift } = await admin
            .from('gift_cards')
            .select('id')
            .eq('deployment_id', deployment.id)
            .eq('token_id', tokenId)
            .in('status', ['pending_escrow', 'active', 'claim_pending', 'cancel_pending'])
            .maybeSingle();
          if (openGift) {
            refused.push({ tokenId, reason: 'already held for a gift card' });
            continue;
          }
          const { error } = await admin.from('promo_pool').insert({
            deployment_id: deployment.id,
            token_id: tokenId,
            campaign_id: campaign.id,
            gem_id: gemId === 0n ? null : gemId.toString(),
            deposited_from: getAddress(depositedFrom).toLowerCase(),
            added_by: user.id,
          });
          if (error) {
            refused.push({
              tokenId,
              reason: error.code === '23505' ? 'already in a promotion pool' : error.message,
            });
            continue;
          }
          added.push(tokenId);
        } catch (tokenError) {
          refused.push({
            tokenId,
            reason: safeErrorMessage(tokenError, 'could not be read on-chain'),
          });
        }
      }
      if (added.length > 0) {
        await audit(user.id, 'promo.tokens_added', 'promo_campaign', campaign.id, {
          tokenIds: added,
          depositedFrom: getAddress(depositedFrom),
          escrow: operator,
        });
      }
      return json({ added, refused });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    // Same answer as the other staff endpoints: a missing capability is a 404.
    if (error instanceof MissingCapabilityError) return json({ error: 'Not found' }, 404);
    const message = safeErrorMessage(error, 'The promotion could not be processed');
    return json({ error: message }, /session|authorization/i.test(message) ? 401 : 400);
  }
});
