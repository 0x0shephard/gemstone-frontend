import { describe, expect, it, vi } from 'vitest';

const createClient = vi.hoisted(() => vi.fn(() => ({ configured: true })));

vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('@/config/env', () => ({
  authConfigured: true,
  env: {
    deploymentRelease: 'sepolia-fresh-11828947',
    supabaseUrl: 'https://project.supabase.co',
    supabaseAnonKey: 'public-anon-key',
  },
}));

const { supabaseClientOptions } = await import('./supabase');

describe('deployment-scoped Supabase client', () => {
  it('sends the immutable release on PostgREST, Storage and Function requests', () => {
    expect(createClient).toHaveBeenCalledWith(
      'https://project.supabase.co',
      'public-anon-key',
      expect.objectContaining({
        global: {
          headers: { 'x-protocol-deployment': 'sepolia-fresh-11828947' },
        },
      }),
    );
  });

  it('leaves local and mock clients unscoped', () => {
    expect(supabaseClientOptions('')).not.toHaveProperty('global');
  });
});
