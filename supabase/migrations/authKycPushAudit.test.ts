import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'supabase/migrations');
const read = (prefix: string) => {
  const name = readdirSync(dir).find((file) => file.startsWith(prefix) && file.endsWith('.sql'));
  if (!name) throw new Error(`No migration ${prefix}`);
  return readFileSync(join(dir, name), 'utf8');
};
const config = readFileSync(join(process.cwd(), 'supabase/config.toml'), 'utf8');

/** The body of a `[section]` in config.toml, up to the next section. */
const tomlSection = (name: string) => {
  const header = new RegExp(`^\\[${name.replace(/[.-]/g, '\\$&')}\\]$`, 'm').exec(config);
  if (!header) return null;
  const rest = config.slice(header.index + header[0].length);
  const end = rest.search(/^\[/m);
  return end < 0 ? rest : rest.slice(0, end);
};

/** The regex the migrations use for push endpoints, compiled for JS. */
const pushPattern = (sql: string) => {
  const match = sql.match(/new\.endpoint !~\* '([^']+)'/);
  if (!match) throw new Error('push endpoint regex not found');
  return new RegExp(match[1].replace('[^[:space:]]', '[^\\s]'), 'i');
};

describe('supabase/config.toml', () => {
  it('turns anonymous sign-ins off', () => {
    expect(tomlSection('auth')).toMatch(/^enable_anonymous_sign_ins = false$/m);
  });

  it('lets Sumsub reach its webhook without a Supabase JWT', () => {
    expect(tomlSection('functions.v1-sumsub-webhook')).toMatch(/^verify_jwt = false$/m);
  });
});

describe('202610300301 block anonymous writes', () => {
  const sql = read('202610300301');

  it('uses restrictive policies, so existing ownership rules are unchanged', () => {
    expect(sql).toContain("'create policy %I on %I.%I as restrictive for %s to authenticated %s'");
    expect(sql).toContain("foreach command in array array['insert', 'update', 'delete']");
    expect(sql).not.toMatch(/drop policy if exists (?!%I)/);
  });

  it('checks the documented is_anonymous claim, tolerating tokens without it', () => {
    expect(sql).toContain("'((select (auth.jwt() ->> ''is_anonymous'')::boolean) is not true)'");
    expect(sql).toContain("when 'insert' then format('with check %s', not_anonymous)");
    expect(sql).toContain(
      "when 'update' then format('using %s with check %s', not_anonymous, not_anonymous)",
    );
  });

  it.each([
    ['storage', 'objects'],
    ['public', 'evidence_files'],
    ['public', 'push_subscriptions'],
    ['public', 'siwe_nonces'],
    ['public', 'wallet_links'],
    ['public', 'notifications'],
    ['public', 'seller_submissions'],
    ['public', 'redemption_requests'],
    ['public', 'profiles'],
  ])('covers %s.%s', (schema, table) => {
    expect(sql).toContain(`('${schema}', '${table}')`);
  });
});

describe('202610300302 KYC tables', () => {
  const sql = read('202610300302');

  it('creates both tables the Sumsub functions write, with RLS on', () => {
    expect(sql).toMatch(/create table if not exists public\.kyc_profiles \(/);
    expect(sql).toMatch(/create table if not exists public\.sumsub_webhook_events \(/);
    expect(sql).toContain('alter table public.kyc_profiles enable row level security;');
    expect(sql).toContain('alter table public.sumsub_webhook_events enable row level security;');
  });

  it('has every column the functions write', () => {
    const kyc = sql.slice(sql.indexOf('create table if not exists public.kyc_profiles'));
    for (const column of [
      'profile_id',
      'applicant_id',
      'status',
      'review_status',
      'review_result',
      'level_name',
      'last_event_at',
      'last_event_id',
      'updated_at',
    ]) {
      expect(kyc, column).toMatch(new RegExp(`\\n  ${column} `));
    }
    expect(sql).toContain(
      "check (status in ('not_started', 'pending', 'approved', 'rejected', 'on_hold'))",
    );
  });

  it('is service-role only, and a user reads only their own status columns', () => {
    expect(sql).toContain('revoke all on table public.kyc_profiles from anon, authenticated;');
    expect(sql).toContain(
      'grant select (profile_id, status, updated_at) on public.kyc_profiles to authenticated;',
    );
    expect(sql).toMatch(
      /create policy kyc_profiles_read_own\s+on public\.kyc_profiles for select\s+to authenticated\s+using \(\(select auth\.uid\(\)\) = profile_id\);/,
    );
    expect(sql).toContain(
      'revoke all on table public.sumsub_webhook_events from anon, authenticated;',
    );
    expect(sql).not.toMatch(/create policy \w+\s+on public\.sumsub_webhook_events/);
    expect(sql).toMatch(
      /revoke all on function public\.apply_sumsub_webhook_event\([^;]+\) from public, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.apply_sumsub_webhook_event\([^;]+\) to service_role;/,
    );
  });

  it('ignores a delivery older than the last applied event for the profile', () => {
    expect(sql).toContain(
      "perform pg_advisory_xact_lock(hashtextextended('sumsub:' || p_profile_id::text, 0));",
    );
    expect(sql).toMatch(
      /on conflict \(profile_id\) do update[\s\S]+?where existing\.last_event_at is null\s+or existing\.last_event_at <= excluded\.last_event_at;/,
    );
    expect(sql).toContain("v_outcome := case when changed > 0 then 'applied' else 'stale' end;");
    expect(sql).toMatch(
      /if exists \(select 1 from public\.sumsub_webhook_events where event_id = p_event_id\) then\s+return 'duplicate';/,
    );
  });

  it('records the event in the same transaction it applies it', () => {
    const body = sql.slice(
      sql.indexOf('create or replace function public.apply_sumsub_webhook_event'),
    );
    expect(body.indexOf('insert into public.kyc_profiles')).toBeLessThan(
      body.indexOf('insert into public.sumsub_webhook_events'),
    );
    expect(body.indexOf('insert into public.sumsub_webhook_events')).toBeLessThan(
      body.indexOf('$$;'),
    );
  });

  it('makes kyc_profiles the one source of truth, with kyc_status a view of it', () => {
    expect(sql).toContain('alter table public.kyc_status rename to kyc_status_legacy;');
    expect(sql).toContain('revoke all on table public.kyc_status_legacy from anon, authenticated;');
    expect(sql).toMatch(
      /create or replace view public\.kyc_status\s+with \(security_invoker = true\)\s+as\s+select profile_id as user_id, status, updated_at\s+from public\.kyc_profiles;/,
    );
    // Legacy statuses were never set by a Sumsub review, so none are trusted.
    expect(sql).not.toMatch(/insert into public\.kyc_profiles[^;]*from public\.kyc_status/);
  });

  it('deletes no data', () => {
    expect(sql).not.toMatch(/\b(delete\s+from|truncate|drop\s+table)\b/i);
  });
});

describe('202610300303 push subscription limits', () => {
  const sql = read('202610300303');
  const allowed = pushPattern(sql);

  it.each([
    'https://fcm.googleapis.com/fcm/send/abc:APA91b',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAAA',
    'https://web.push.apple.com/QGx0',
    'https://wns2-par02p.notify.windows.com/w/?token=BQYAAA',
  ])('accepts %s', (endpoint) => {
    expect(allowed.test(endpoint)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://169.254.169.254/latest/meta-data',
    'https://fcm.googleapis.com.evil.example/x',
    'https://fcm.googleapis.com@evil.example/x',
    'https://fcm.googleapis.com:8443/x',
    'https://fcm.googleapis.com',
    'https://localhost/push',
  ])('refuses %s', (endpoint) => {
    expect(allowed.test(endpoint)).toBe(false);
  });

  it('uses the same pattern for the trigger and for retiring old rows', () => {
    const patterns = [...sql.matchAll(/endpoint !~\* '([^']+)'/g)].map((match) => match[1]);
    expect(patterns).toHaveLength(2);
    expect(new Set(patterns).size).toBe(1);
  });

  it('caps each account at 10 rows by pruning the least recently used', () => {
    expect(sql).toContain('max_per_profile constant integer := 10;');
    expect(sql).toMatch(
      /order by \(expired_at is null\) desc, coalesce\(last_used_at, created_at\) desc\s+offset max_per_profile - 1/,
    );
    expect(sql).toContain('where ranked.position > 10');
  });

  it('runs on every insert and on endpoint changes', () => {
    expect(sql).toMatch(
      /create trigger push_subscriptions_guard\s+before insert or update of endpoint on public\.push_subscriptions\s+for each row execute function public\.guard_push_subscription\(\);/,
    );
    expect(sql).not.toMatch(/security definer/i);
  });

  it('matches the Edge allowlist', () => {
    const webpush = readFileSync(
      join(process.cwd(), 'supabase/functions/_shared/webpush.ts'),
      'utf8',
    );
    for (const host of [
      'fcm.googleapis.com',
      'push.services.mozilla.com',
      'push.apple.com',
      'notify.windows.com',
    ]) {
      expect(webpush).toContain(`'${host}'`);
      expect(sql).toContain(host.replaceAll('.', '\\.'));
    }
  });
});

describe('202610300304 SIWE nonce limits', () => {
  const sql = read('202610300304');

  it('allows at most 10 nonces per account per 10 minutes', () => {
    expect(sql).toContain('max_per_window constant integer := 10;');
    expect(sql).toMatch(/created_at > now\(\) - interval '10 minutes'/);
    expect(sql).toContain("raise exception 'siwe_nonce_rate_limited'");
    const fn = readFileSync(
      join(process.cwd(), 'supabase/functions/v1-siwe-nonce/index.ts'),
      'utf8',
    );
    expect(fn).toContain("const RATE_LIMITED = 'siwe_nonce_rate_limited';");
    expect(fn).toMatch(/includes\(RATE_LIMITED\)\) \{\s*return json\([^)]+\)?,\s*429\);/);
  });

  it('serializes per account so concurrent requests cannot both pass', () => {
    expect(sql).toContain(
      "perform pg_advisory_xact_lock(hashtextextended('siwe:' || new.profile_id::text, 0));",
    );
  });

  it('cleans up expired nonces without a scheduler', () => {
    expect(sql).not.toMatch(/cron\./);
    expect(sql).toMatch(/expires_at < now\(\) - interval '1 hour'/);
    expect(sql).toMatch(/limit 200\s+for update skip locked/);
    expect(sql).toMatch(
      /create trigger siwe_nonces_rate_limit\s+before insert on public\.siwe_nonces/,
    );
  });

  it('only ever deletes nonces that have expired', () => {
    const deletes = [...sql.matchAll(/delete from public\.siwe_nonces[\s\S]*?;/g)].map(
      (match) => match[0],
    );
    expect(deletes.length).toBe(3);
    for (const statement of deletes) expect(statement).toMatch(/expires_at < now\(\) - interval/);
  });
});

describe('202610300305 wallet link chain proof', () => {
  const sql = read('202610300305');

  it('records how a link was proven', () => {
    expect(sql).toContain('add column if not exists signature_kind text;');
    expect(sql).toContain(
      "check (signature_kind is null or signature_kind in ('eoa', 'contract'))",
    );
  });

  it('demotes non-EOA links proven on a chain other than the active one', () => {
    expect(sql).toMatch(
      /update public\.wallet_links as wl\s+set is_primary = false\s+from public\.protocol_deployments as pd\s+where pd\.status = 'active'\s+and wl\.is_primary\s+and wl\.chain_id <> pd\.chain_id\s+and wl\.signature_kind is distinct from 'eoa';/,
    );
  });

  it('applies the same rule whenever another deployment is activated', () => {
    expect(sql).toMatch(
      /create trigger protocol_deployments_demote_cross_chain_links\s+after update of status on public\.protocol_deployments/,
    );
    expect(sql).toMatch(
      /and chain_id <> new\.chain_id\s+and signature_kind is distinct from 'eoa';/,
    );
  });

  it('deletes no links', () => {
    expect(sql).not.toMatch(/delete\s+from/i);
  });
});
