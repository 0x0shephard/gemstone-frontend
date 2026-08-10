import { adminClient } from './auth.ts';

/**
 * Canva Connect: PKCE, token exchange, and keeping a grant alive.
 *
 * Canva mandates the authorization-code flow with PKCE (SHA-256) *and* Basic
 * authentication with the client secret, and states that those requests
 * "can't be made from a web-browser client". Both halves therefore run here.
 */

export const CANVA_AUTHORIZE_URL = 'https://www.canva.com/api/oauth/authorize';
export const CANVA_TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token';
export const CANVA_API = 'https://api.canva.com/rest/v1';

/**
 * `asset:write` to upload the rendered card, `asset:read` because polling the
 * upload job needs it — Canva grants no read from a write scope, so omitting it
 * uploads successfully and then fails at the status check — and
 * `design:content:write` to turn the asset into a design the sender can open.
 *
 * Nothing broader. In particular there is no `design:meta:read`, so this grant
 * cannot enumerate the designs already in someone's Canva account.
 */
export const CANVA_SCOPES = 'asset:read asset:write design:content:write';

export class CanvaNotConfiguredError extends Error {
  constructor() {
    super('Canva is not configured');
    this.name = 'CanvaNotConfiguredError';
  }
}

export class CanvaNotConnectedError extends Error {
  constructor() {
    super('Connect your Canva account first');
    this.name = 'CanvaNotConnectedError';
  }
}

export function canvaConfigured(): boolean {
  return Boolean(Deno.env.get('CANVA_CLIENT_ID')?.trim() && Deno.env.get('CANVA_SECRET')?.trim());
}

function credentials(): { clientId: string; secret: string } {
  const clientId = Deno.env.get('CANVA_CLIENT_ID')?.trim();
  const secret = Deno.env.get('CANVA_SECRET')?.trim();
  if (!clientId || !secret) throw new CanvaNotConfiguredError();
  return { clientId, secret };
}

/** Base64url, per RFC 7636 — no padding, URL-safe alphabet. */
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function randomVerifier(): string {
  // 96 bytes → 128 base64url characters, the maximum RFC 7636 allows.
  return base64url(crypto.getRandomValues(new Uint8Array(96)));
}

export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

async function requestToken(form: Record<string, string>): Promise<TokenResponse> {
  const { clientId, secret } = credentials();
  const response = await fetch(CANVA_TOKEN_URL, {
    method: 'POST',
    headers: {
      // Basic rather than form-encoded credentials: Canva documents the latter
      // as an alternative and explicitly does not recommend it.
      authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form).toString(),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Canva rejected the token request: ${detail || response.status}`);
  }
  return (await response.json()) as TokenResponse;
}

export function exchangeCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<TokenResponse> {
  return requestToken({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
  });
}

export async function storeConnection(profileId: string, tokens: TokenResponse): Promise<void> {
  const { error } = await adminClient()
    .from('canva_connections')
    .upsert(
      {
        profile_id: profileId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(Date.now() + tokens.expires_in * 1_000).toISOString(),
        scopes: tokens.scope,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'profile_id' },
    );
  if (error) throw error;
}

/**
 * A usable access token for this user, refreshing if it is close to expiring.
 *
 * The sixty-second margin exists because the upload and design calls that
 * follow take real time; a token with two seconds left passes a naive check and
 * then fails halfway through the sequence, after the asset has been uploaded.
 */
export async function accessTokenFor(profileId: string): Promise<string> {
  const admin = adminClient();
  const { data: connection } = await admin
    .from('canva_connections')
    .select('access_token,refresh_token,expires_at')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (!connection) throw new CanvaNotConnectedError();

  const expiresAt = new Date(connection.expires_at as string).getTime();
  if (expiresAt - Date.now() > 60_000) return connection.access_token as string;

  const refreshed = await requestToken({
    grant_type: 'refresh_token',
    refresh_token: connection.refresh_token as string,
  });
  await storeConnection(profileId, refreshed);
  return refreshed.access_token;
}

/** Canva returns problem details as JSON; surface its message, not the status. */
export async function canvaError(response: Response, fallback: string): Promise<Error> {
  const detail = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(detail) as { message?: string; code?: string };
    return new Error(parsed.message ?? parsed.code ?? fallback);
  } catch {
    return new Error(detail || fallback);
  }
}
