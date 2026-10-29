import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  recoverMessageAddress,
  type Address,
  type Hex,
} from 'npm:viem@2';
import { parseSiweMessage, verifySiweMessage } from 'npm:viem@2/siwe';
import { adminClient, audit, requireUser, sha256 } from '../_shared/auth.ts';
import {
  configuredChainId,
  siweTimesValid,
  type WalletSignatureKind,
} from '../_shared/authPolicy.ts';
import { json, preflight } from '../_shared/cors.ts';
import { resolveSiteOrigin } from '../_shared/origins.ts';
import { backfillProfileLinks } from '../_shared/notify.ts';

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  // Fail closed: no default chain, so a lost secret cannot reopen Sepolia.
  const expectedChain = configuredChainId(Deno.env.get('CHAIN_ID'));
  if (expectedChain === null) {
    console.error('v1-siwe-verify: CHAIN_ID is not set to a positive integer');
    return json({ error: 'Wallet linking is not configured' }, 503);
  }

  let user;
  try {
    user = await requireUser(request);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid session' }, 401);
  }

  try {
    const { message, signature, confirmRelink = false } = await request.json();
    const parsed = parseSiweMessage(message);
    const expectedOrigin = resolveSiteOrigin(parsed.domain, parsed.uri);
    const now = new Date();
    if (
      !expectedOrigin ||
      parsed.chainId !== expectedChain ||
      !parsed.address ||
      !parsed.nonce ||
      // `issuedAt` is the wallet's clock and may run up to a minute ahead.
      !siweTimesValid(parsed, now)
    )
      return json({ error: 'Invalid SIWE fields' }, 400);

    const rpcUrl = Deno.env.get('SIWE_RPC_URL');
    if (!rpcUrl) return json({ error: 'SIWE RPC is not configured' }, 503);
    const chain = defineChain({
      id: expectedChain,
      name: Deno.env.get('CHAIN_NAME')?.trim() || `EVM chain ${expectedChain}`,
      nativeCurrency: {
        name: Deno.env.get('NATIVE_CURRENCY_NAME')?.trim() || 'Ether',
        symbol: Deno.env.get('NATIVE_CURRENCY_SYMBOL')?.trim() || 'ETH',
        decimals: 18,
      },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });
    const verified = await verifySiweMessage(publicClient, {
      message,
      signature: signature as Hex,
      address: parsed.address as Address,
      domain: expectedOrigin.host,
      nonce: parsed.nonce,
      time: now,
    });
    if (!verified) return json({ error: 'Invalid signature' }, 401);

    /*
     * Which kind of signer proved this. `verifySiweMessage` accepts an EOA
     * signature, an ERC-1271 contract wallet and an ERC-6492 counterfactual one.
     * Only the first is proof on every chain: a contract wallet is proven on
     * `expectedChain` alone, since the same address on another chain can be a
     * different contract with different owners. The link records both so a
     * later reader (or a chain switch) can tell which links still hold.
     */
    const signatureKind: WalletSignatureKind = await recoverMessageAddress({
      message,
      signature: signature as Hex,
    })
      .then((recovered) =>
        recovered.toLowerCase() === String(parsed.address).toLowerCase() ? 'eoa' : 'contract',
      )
      .catch(() => 'contract' as const);

    const admin = adminClient();
    const nonceHash = await sha256(parsed.nonce);
    const { data: nonce, error: nonceError } = await admin
      .from('siwe_nonces')
      .update({ used_at: now.toISOString() })
      .eq('profile_id', user.id)
      .eq('nonce_hash', nonceHash)
      .eq('domain', parsed.domain)
      .eq('uri', parsed.uri)
      .eq('chain_id', expectedChain)
      .is('used_at', null)
      .gt('expires_at', now.toISOString())
      .select('id')
      .maybeSingle();
    if (nonceError || !nonce) return json({ error: 'Nonce expired or already used' }, 409);

    const walletAddress = getAddress(parsed.address).toLowerCase();
    const { data: currentPrimary } = await admin
      .from('wallet_links')
      .select('id,wallet_address')
      .eq('profile_id', user.id)
      .eq('is_primary', true)
      .maybeSingle();
    if (currentPrimary && currentPrimary.wallet_address !== walletAddress && !confirmRelink) {
      return json(
        { error: 'Explicit relink confirmation required', requiresConfirmation: true },
        409,
      );
    }

    await admin.from('wallet_links').update({ is_primary: false }).eq('profile_id', user.id);
    const { data: link, error } = await admin
      .from('wallet_links')
      .upsert(
        {
          profile_id: user.id,
          wallet_address: walletAddress,
          chain_id: expectedChain,
          signature_kind: signatureKind,
          is_primary: true,
          verified_at: now.toISOString(),
        },
        { onConflict: 'wallet_address' },
      )
      .select('wallet_address,verified_at')
      .single();
    if (error) throw error;
    /*
     * Notifications are addressed to a wallet, because a token can reach someone
     * who has no account — a gift, a plain transfer — and those holders still
     * have deadlines. Anything written before this moment names the wallet and
     * no profile, so without this the person who was emailed about an offer, and
     * signed up in order to act on it, would arrive at an empty list.
     *
     * Not fatal: a wallet is linked either way, and the alternative is failing a
     * sign-in over a backfill.
     */
    await backfillProfileLinks(admin, walletAddress, user.id).catch(() => undefined);
    await audit(
      user.id,
      currentPrimary ? 'wallet.relinked' : 'wallet.linked',
      'wallet_link',
      walletAddress,
    );
    return json(link);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'SIWE verification failed' },
      400,
    );
  }
});
