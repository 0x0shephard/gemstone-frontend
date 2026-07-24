import { createClient, type User } from 'npm:@supabase/supabase-js@2';

export function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
}

export async function requireUser(request: Request): Promise<User> {
  const authorization = request.headers.get('Authorization');
  if (!authorization) throw new Error('Missing authorization');
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('Invalid session');
  return data.user;
}

export async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function randomHex(bytes = 32): `0x${string}` {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return `0x${[...value].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function audit(
  profileId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown> = {},
) {
  const { error } = await adminClient()
    .from('audit_records')
    .insert({
      profile_id: profileId,
      actor: profileId ? 'user' : 'system',
      action,
      entity_type: entityType,
      entity_id: entityId,
      details,
    });
  if (error) throw error;
}
