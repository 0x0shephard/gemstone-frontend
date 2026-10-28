import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'supabase/migrations');
const migrations = readdirSync(dir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));

const roles = (list: string) =>
  list
    .split(',')
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);

/**
 * Every function grant and revoke, in migration order. Supabase's default
 * privileges grant EXECUTE to `anon` and `authenticated` by name, so only a
 * revoke naming them takes those grants away; `from public` alone does not.
 */
function functionPrivileges() {
  const byFunction = new Map<
    string,
    { granted: Set<string>; lastRevoke?: string[]; where: string }
  >();
  const statement =
    /\b(revoke|grant)\s+(?:all|execute)\s+on\s+function\s+public\.(\w+)\s*\([^;]*?\)\s+(?:from|to)\s+([^;]+);/gi;
  for (const { name, sql } of migrations) {
    for (const [, verb, fn, list] of sql.matchAll(statement)) {
      const entry = byFunction.get(fn) ?? { granted: new Set<string>(), where: name };
      if (verb.toLowerCase() === 'grant') roles(list).forEach((role) => entry.granted.add(role));
      else {
        entry.lastRevoke = roles(list);
        roles(list).forEach((role) => entry.granted.delete(role));
      }
      entry.where = name;
      byFunction.set(fn, entry);
    }
  }
  return byFunction;
}

describe('service-only database functions', () => {
  const privileges = functionPrivileges();

  it('finds the functions it guards', () => {
    expect(privileges.get('activate_protocol_deployment')).toBeDefined();
    expect(privileges.get('record_valuation')).toBeDefined();
  });

  // A function someone revoked and never granted to clients is meant to be
  // server-only, whether or not it also has an explicit service_role grant.
  it.each(
    [...privileges].filter(
      ([, entry]) => !entry.granted.has('anon') && !entry.granted.has('authenticated'),
    ),
  )('%s is revoked from anon and authenticated by name', (_fn, entry) => {
    expect(entry.lastRevoke, entry.where).toEqual(
      expect.arrayContaining(['anon', 'authenticated']),
    );
  });
});

describe('202610280001 service-only grants', () => {
  const sql = migrations.find(({ name }) => name.startsWith('202610280001'))?.sql ?? '';

  it('turns on RLS for the notification cursors and drops client access', () => {
    expect(sql).toContain('alter table public.notification_scan_state enable row level security;');
    expect(sql).toContain(
      'revoke all on table public.notification_scan_state from anon, authenticated;',
    );
  });

  it('leaves profiles readable by their owner and writable only by the signup trigger', () => {
    for (const policy of ['profiles_own', 'profiles_insert_own', 'profiles_update_own']) {
      expect(sql).toContain(`drop policy if exists ${policy} on public.profiles;`);
    }
    expect(sql).toMatch(
      /create policy profiles_select_own\s+on public\.profiles for select\s+to authenticated/,
    );
    expect(sql).toContain(
      'revoke insert, update, delete, truncate on table public.profiles from anon, authenticated;',
    );
  });

  it('deletes no data', () => {
    expect(sql).not.toMatch(/\b(delete\s+from|truncate\s+public|drop\s+table)\b/i);
  });
});
