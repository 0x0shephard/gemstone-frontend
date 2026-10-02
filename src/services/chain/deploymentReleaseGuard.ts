import { env } from '@/config/env';
import { supabase } from '@/providers/supabase';

interface ActiveDeploymentManifest {
  release?: unknown;
}

interface ActiveDeploymentRow {
  deployment_id?: unknown;
}

export class DeploymentReleaseGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeploymentReleaseGuardError';
  }
}

/**
 * Proves that the document currently served by this origin belongs to the same
 * immutable protocol release as the JavaScript that is about to open a wallet.
 *
 * This is intentionally performed immediately before every wallet interaction,
 * rather than once at application startup. A tab can remain open across a
 * Netlify cutover; its old JavaScript must stop signing as soon as the active
 * no-cache manifest changes. Local/mock builds without a selected release keep
 * working because they do not target an immutable deployed suite.
 */
export async function assertActiveDeploymentRelease(
  expectedRelease = env.deploymentRelease,
  request: typeof fetch = fetch,
): Promise<void> {
  const expected = expectedRelease?.trim();
  if (!expected) return;

  let response: Response;
  try {
    response = await request(
      `/deployment-manifest.json?release-check=${encodeURIComponent(expected)}`,
      {
        cache: 'no-store',
        headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
      },
    );
  } catch {
    throw new DeploymentReleaseGuardError(
      'Could not verify the active Digital Carat release. Refresh the page and try again; no wallet request was sent.',
    );
  }

  if (!response.ok) {
    throw new DeploymentReleaseGuardError(
      'Could not verify the active Digital Carat release. Refresh the page and try again; no wallet request was sent.',
    );
  }

  let manifest: ActiveDeploymentManifest;
  try {
    manifest = (await response.json()) as ActiveDeploymentManifest;
  } catch {
    throw new DeploymentReleaseGuardError(
      'The active Digital Carat release could not be verified. Refresh the page; no wallet request was sent.',
    );
  }

  if (manifest.release !== expected) {
    throw new DeploymentReleaseGuardError(
      'Digital Carat was updated while this tab was open. Refresh the page before continuing; no wallet request was sent.',
    );
  }

  if (!supabase) {
    throw new DeploymentReleaseGuardError(
      'Could not verify the active protocol deployment. Refresh the page and try again; no wallet request was sent.',
    );
  }

  let activeRelease: unknown;
  try {
    const { data, error } = await supabase.rpc('current_protocol_deployment');
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as ActiveDeploymentRow | null;
    activeRelease = row?.deployment_id;
  } catch {
    throw new DeploymentReleaseGuardError(
      'Could not verify the active protocol deployment. Refresh the page and try again; no wallet request was sent.',
    );
  }

  if (activeRelease !== expected) {
    throw new DeploymentReleaseGuardError(
      'The protocol deployment changed while this tab was open. Refresh the page before continuing; no wallet request was sent.',
    );
  }
}
