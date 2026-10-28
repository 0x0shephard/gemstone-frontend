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
 * Read-only SECURITY DEFINER helpers that clients are meant to call. Anything
 * else defined SECURITY DEFINER runs with the owner's rights, so it must be
 * closed to the anon key.
 */
const PUBLIC_READ_HELPERS = new Set([
  'current_protocol_deployment',
  'current_protocol_deployment_id',
  'current_user_has_verified_email',
  'marketplace_profile_names',
  'open_gift_token_ids',
  'public_gem_custody',
  'requested_protocol_deployment_id',
  'requested_protocol_deployment_is_active',
]);

type Event =
  | { at: number; kind: 'create'; fn: string; definer: boolean; trigger: boolean }
  | { at: number; kind: 'grant' | 'revoke'; fn: string; roles: string[] };

/**
 * Each function's EXECUTE grant to `anon`, replayed through every migration.
 * Supabase's default privileges grant EXECUTE on a new public function to
 * `anon` and `authenticated` by name, so only a revoke naming them closes it;
 * `revoke ... from public` alone does not. `create or replace` of an existing
 * function keeps its grants.
 */
function definerFunctions() {
  const events: Event[] = [];
  migrations.forEach(({ sql }, file) => {
    const at = (offset: number) => file * 1e9 + offset;
    for (const match of sql.matchAll(
      /\bcreate\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(/gi,
    )) {
      const header = sql.slice(match.index, sql.indexOf('$', match.index));
      events.push({
        at: at(match.index),
        kind: 'create',
        fn: match[1],
        definer: /\bsecurity\s+definer\b/i.test(header),
        trigger: /\breturns\s+trigger\b/i.test(header),
      });
    }
    for (const match of sql.matchAll(
      /\b(revoke|grant)\s+(?:all(?:\s+privileges)?|execute)\s+on\s+function\s+public\.(\w+)\s*\([^;]*?\)\s+(?:from|to)\s+([^;]+);/gi,
    )) {
      const kind = match[1].toLowerCase() as 'grant' | 'revoke';
      events.push({ at: at(match.index), kind, fn: match[2], roles: roles(match[3]) });
    }
  });
  events.sort((a, b) => a.at - b.at);

  const state = new Map<
    string,
    { definer: boolean; trigger: boolean; anon: boolean; authenticated: boolean }
  >();
  for (const event of events) {
    const current = state.get(event.fn);
    if (event.kind === 'create') {
      if (current) Object.assign(current, { definer: event.definer, trigger: event.trigger });
      else
        state.set(event.fn, {
          definer: event.definer,
          trigger: event.trigger,
          anon: true,
          authenticated: true,
        });
      continue;
    }
    if (!current) continue;
    const open = event.kind === 'grant';
    for (const role of event.roles) {
      if (role === 'anon') current.anon = open;
      if (role === 'authenticated') current.authenticated = open;
    }
  }
  return state;
}

describe('SECURITY DEFINER functions', () => {
  const functions = definerFunctions();

  it('finds the functions it guards', () => {
    expect(functions.get('activate_protocol_deployment')?.definer).toBe(true);
    expect(functions.get('record_valuation')?.definer).toBe(true);
  });

  it('allow-lists only helpers that exist', () => {
    for (const fn of PUBLIC_READ_HELPERS) expect(functions.has(fn), fn).toBe(true);
  });

  // A trigger function cannot be called through the API, so its grant is moot.
  it.each(
    [...functions].filter(
      ([fn, entry]) => entry.definer && !entry.trigger && !PUBLIC_READ_HELPERS.has(fn),
    ),
  )('%s is not executable by anon or authenticated', (_fn, entry) => {
    expect({ anon: entry.anon, authenticated: entry.authenticated }).toEqual({
      anon: false,
      authenticated: false,
    });
  });

  it('never grants schema-wide or changes default privileges', () => {
    for (const { name, sql } of migrations) {
      expect(sql, name).not.toMatch(
        /on\s+all\s+functions\s+in\s+schema|alter\s+default\s+privileges/i,
      );
    }
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
