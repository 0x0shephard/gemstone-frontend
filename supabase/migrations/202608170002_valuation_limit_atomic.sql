-- Enforcing the daily valuation limit where it can actually be enforced.
--
-- The check counted the last 24 hours and the insert followed as a separate
-- round trip, so two graders in the same organisation could both pass a check
-- that said "one remaining" and both write. The limit bounds how much damage one
-- compromised account can do in a day, which is exactly the situation where an
-- attacker sends requests concurrently.
--
-- Counting and inserting in one statement is the only version that holds. The
-- advisory lock serialises organisations against each other rather than locking
-- the table, so two labs grading at once are unaffected.

create or replace function public.record_valuation(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  organization uuid := (payload ->> 'organization_id')::uuid;
  allowed integer;
  used integer;
  inserted uuid;
begin
  if organization is null then
    raise exception 'organization_id is required' using errcode = '22023';
  end if;

  -- Held until this transaction ends, which is the end of this statement. Two
  -- calls for the same organisation therefore queue; different organisations do
  -- not contend at all.
  perform pg_advisory_xact_lock(hashtextextended(organization::text, 0));

  select daily_valuation_limit into allowed
  from public.verifier_organizations
  where id = organization and active;
  if allowed is null then
    raise exception 'Verifier organisation is not active' using errcode = '42501';
  end if;

  select count(*) into used
  from public.valuations
  where organization_id = organization
    and created_at >= now() - interval '24 hours';

  if used >= allowed then
    -- A distinct code so the endpoint can report the limit rather than a
    -- generic database failure.
    raise exception 'Daily valuation limit of % reached', allowed using errcode = 'DC001';
  end if;

  insert into public.valuations (
    submission_id,
    organization_id,
    graded_by,
    matrix_version,
    matrix_hash,
    graded_inputs,
    demand_snapshot,
    breakdown,
    approved_valuation_usd,
    valuation_hash,
    canonical_payload,
    nonce
  )
  values (
    (payload ->> 'submission_id')::uuid,
    organization,
    (payload ->> 'graded_by')::uuid,
    payload ->> 'matrix_version',
    payload ->> 'matrix_hash',
    payload -> 'graded_inputs',
    payload -> 'demand_snapshot',
    payload -> 'breakdown',
    (payload ->> 'approved_valuation_usd')::numeric,
    payload ->> 'valuation_hash',
    payload ->> 'canonical_payload',
    payload ->> 'nonce'
  )
  returning id into inserted;

  return inserted;
end;
$$;

comment on function public.record_valuation(jsonb) is
  'Writes a valuation only if the organisation is under its rolling 24-hour limit. Counting and inserting in one statement, behind a per-organisation advisory lock, is what stops two concurrent graders from both passing the same check.';

-- The sweep and the grading endpoint call this through the service role. No
-- grant to `authenticated`: a lab reaches it through the endpoint, which is
-- where membership and role are established.
revoke all on function public.record_valuation(jsonb) from public;
