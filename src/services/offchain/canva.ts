import { invokeEdgeFunction } from './invoke';

/**
 * Canva Connect, from the browser's side.
 *
 * Every call goes through an Edge Function. Canva blocks token exchange from
 * web clients outright, and the resulting access token acts on the user's whole
 * Canva account — so it stays server-side and the browser only ever sees the
 * design link that comes out the far end.
 */

/** Where the authorize redirect is parked while the user is at Canva. */
const RETURN_KEY = 'dc:canva-return';

export interface CanvaDesign {
  designId: string;
  editUrl: string;
  viewUrl: string;
}

export async function startCanvaAuthorization(returnTo: string): Promise<string> {
  const { authorizeUrl } = await invokeEdgeFunction<{ authorizeUrl: string }>(
    'v1-canva-authorize',
    {},
  );
  // Canva's redirect URI is a single registered URL, so it cannot carry the page
  // the user came from. Parked here instead and read once on the way back.
  sessionStorage.setItem(RETURN_KEY, returnTo);
  return authorizeUrl;
}

export function consumeCanvaReturn(): string {
  const value = sessionStorage.getItem(RETURN_KEY);
  sessionStorage.removeItem(RETURN_KEY);
  return value ?? '/profile';
}

export function completeCanvaAuthorization(
  code: string,
  state: string,
): Promise<{ connected: boolean }> {
  return invokeEdgeFunction('v1-canva-callback', { code, state });
}

export function exportCardToCanva(input: {
  pngBase64: string;
  title: string;
  width: number;
  height: number;
}): Promise<CanvaDesign> {
  return invokeEdgeFunction<CanvaDesign>('v1-canva-export', input);
}

/**
 * True when the failure was "no Canva account linked yet" rather than a real
 * error. The export endpoint answers 409 for it, so the UI can offer to connect
 * instead of reporting something broken.
 */
export function needsCanvaConnection(error: unknown): boolean {
  return error instanceof Error && /connect your canva account/i.test(error.message);
}
