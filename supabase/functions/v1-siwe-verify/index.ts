import { getAddress, type Address, type Hex } from 'npm:viem@2';
import { parseSiweMessage, verifySiweMessage } from 'npm:viem@2/siwe';
import { adminClient, audit, requireUser, sha256 } from '../_shared/auth.ts';
import { json, preflight } from '../_shared/cors.ts';

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  try {
    const user = await requireUser(request);
    const { message, signature, confirmRelink = false } = await request.json();
    const parsed = parseSiweMessage(message);
    const expectedOrigin = new URL(Deno.env.get('SITE_ORIGIN')!);
    const expectedChain = Number(Deno.env.get('CHAIN_ID') ?? 11155111);
    const now = new Date();
    if (
      parsed.domain !== expectedOrigin.host ||
      parsed.uri !== expectedOrigin.origin ||
      parsed.chainId !== expectedChain ||
      !parsed.address ||
      !parsed.nonce ||
      !parsed.issuedAt ||
      !parsed.expirationTime ||
      parsed.issuedAt > now ||
      parsed.expirationTime <= now
    )
      return json({ error: 'Invalid SIWE fields' }, 400);

    const admin = adminClient();
    const nonceHash = await sha256(parsed.nonce);
    const { data: nonce, error: nonceError } = await admin
      .from('siwe_nonces')
      .update({ used_at: now.toISOString() })
      .eq('profile_id', user.id)
      .eq('nonce_hash', nonceHash)
      .is('used_at', null)
      .gt('expires_at', now.toISOString())
      .select('id')
      .maybeSingle();
    if (nonceError || !nonce) return json({ error: 'Nonce expired or already used' }, 409);

    const verified = await verifySiweMessage({
      message,
      signature: signature as Hex,
      address: parsed.address as Address,
      domain: expectedOrigin.host,
      nonce: parsed.nonce,
      time: now,
    });
    if (!verified) return json({ error: 'Invalid signature' }, 401);

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
          is_primary: true,
          verified_at: now.toISOString(),
        },
        { onConflict: 'wallet_address' },
      )
      .select('wallet_address,verified_at')
      .single();
    if (error) throw error;
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
