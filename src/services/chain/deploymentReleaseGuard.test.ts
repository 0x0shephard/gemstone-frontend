import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/providers/supabase', () => ({ supabase: { rpc } }));

import {
  assertActiveDeploymentRelease,
  DeploymentReleaseGuardError,
} from './deploymentReleaseGuard';

describe('deployment release guard', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({
      data: [{ deployment_id: 'sepolia-fresh-11828947' }],
      error: null,
    });
  });

  it('uses an uncached manifest read immediately before a deployed wallet request', async () => {
    const request = vi.fn(
      async () => new Response(JSON.stringify({ release: 'sepolia-fresh-11828947' })),
    );

    await expect(
      assertActiveDeploymentRelease('sepolia-fresh-11828947', request),
    ).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith(
      '/deployment-manifest.json?release-check=sepolia-fresh-11828947',
      {
        cache: 'no-store',
        headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
      },
    );
    expect(rpc).toHaveBeenCalledWith('current_protocol_deployment');
  });

  it('blocks during a rollback interval when the site is still fresh but the database is legacy', async () => {
    const request = vi.fn(
      async () => new Response(JSON.stringify({ release: 'sepolia-fresh-11828947' })),
    );
    rpc.mockResolvedValueOnce({
      data: [{ deployment_id: 'sepolia-11155111-40fe3f22' }],
      error: null,
    });

    await expect(assertActiveDeploymentRelease('sepolia-fresh-11828947', request)).rejects.toThrow(
      /protocol deployment changed/i,
    );
  });

  it('fails closed when the authoritative deployment lookup is unavailable', async () => {
    const request = vi.fn(
      async () => new Response(JSON.stringify({ release: 'sepolia-fresh-11828947' })),
    );
    rpc.mockResolvedValueOnce({ data: null, error: new Error('offline') });

    await expect(assertActiveDeploymentRelease('sepolia-fresh-11828947', request)).rejects.toThrow(
      /could not verify the active protocol deployment/i,
    );
  });

  it('blocks a stale legacy tab after the active manifest switches to fresh', async () => {
    const request = vi.fn(
      async () => new Response(JSON.stringify({ release: 'sepolia-fresh-11828947' })),
    );

    await expect(
      assertActiveDeploymentRelease('sepolia-11155111-40fe3f22', request),
    ).rejects.toBeInstanceOf(DeploymentReleaseGuardError);
  });

  it('accepts the canonical legacy release after a complete rollback', async () => {
    const legacyRelease = 'sepolia-11155111-40fe3f22';
    const request = vi.fn(async () => new Response(JSON.stringify({ release: legacyRelease })));
    rpc.mockResolvedValueOnce({ data: [{ deployment_id: legacyRelease }], error: null });

    await expect(assertActiveDeploymentRelease(legacyRelease, request)).resolves.toBeUndefined();
  });

  it.each([
    ['network failure', vi.fn(async () => Promise.reject(new Error('offline')))],
    ['missing manifest', vi.fn(async () => new Response('', { status: 404 }))],
    ['invalid manifest', vi.fn(async () => new Response('not json'))],
  ])('fails closed on %s', async (_name, request) => {
    await expect(
      assertActiveDeploymentRelease('sepolia-fresh-11828947', request),
    ).rejects.toBeInstanceOf(DeploymentReleaseGuardError);
  });

  it('does not add a production release dependency to local or mock builds', async () => {
    const request = vi.fn();
    await expect(assertActiveDeploymentRelease('', request)).resolves.toBeUndefined();
    expect(request).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
