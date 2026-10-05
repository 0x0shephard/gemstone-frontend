-- Additive operational lifecycle foundation.
--
-- Existing seller, account, valuation and redemption rows are preserved. We do
-- not manufacture historical events for them: projections are created lazily
-- when a real post-migration action occurs and carry `legacy_baseline = true`
-- when their starting state came from an older mutable row.

alter table public.verifier_organizations
  drop constraint if exists verifier_organizations_kind_check;
alter table public.verifier_organizations
  add constraint verifier_organizations_kind_check
  check (kind in ('lab', 'gemlab', 'bank', 'custodian', 'admin'));

alter table public.verifier_members
  drop constraint if exists verifier_members_role_check;
alter table public.verifier_members
  add constraint verifier_members_role_check
  check (role in (
    'grader', 'gemologist', 'bank_operator', 'custody_operator',
    'custodian', 'org_admin'
  ));

create table public.valuation_matrix_versions (
  id uuid primary key default gen_random_uuid(),
  deployment_id text not null references public.protocol_deployments(id) on delete restrict,
  version text not null,
  state text not null check (state in ('draft', 'proposed', 'active', 'retired')),
  matrix_document jsonb not null,
  canonical_document text not null,
  matrix_hash text not null check (matrix_hash ~ '^0x[0-9a-f]{64}$'),
  created_by uuid not null,
  proposed_at timestamptz,
  approved_by uuid,
  activated_at timestamptz,
  supersedes_id uuid references public.valuation_matrix_versions(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (deployment_id, version),
  unique (deployment_id, matrix_hash),
  check ((state <> 'active') or (approved_by is not null and activated_at is not null))
);

create unique index valuation_matrix_one_active
  on public.valuation_matrix_versions(deployment_id)
  where state = 'active';

-- Seed the exact matrix used by the current pricing engine. This is a snapshot,
-- not a second implementation: its canonical hash matches VALUATION_MATRIX in
-- `_shared/valuationMatrix.ts`. Every later edit is a new proposed version.
insert into public.valuation_matrix_versions(
  deployment_id, version, state, matrix_document, canonical_document,
  matrix_hash, created_by, approved_by, activated_at
)
select
  id,
  'digital-carat-matrix-v3',
  'active',
  $matrix${"version":"digital-carat-matrix-v3","varieties":{"emerald":{"basePricePerCaratUsd":"1000","colors":["green"],"colorGrades":["bluish green","deep green","light green"]},"sapphire":{"basePricePerCaratUsd":"1200","colors":["blue","purple","gray","green","brown","orange","pink","violet","white","yellow"],"colorGrades":["dark","medium","light"]},"ruby":{"basePricePerCaratUsd":"1500","colors":["red"],"colorGrades":["dark","medium","light"]},"peridot":{"basePricePerCaratUsd":"200","colors":["green"],"colorGrades":["dark","medium","light"]},"tourmaline":{"basePricePerCaratUsd":"400","colors":["blue","bluish green","greenish blue","orangey red","pink","pinkish red","red","watermelon"],"colorGrades":["dark","medium","light"]},"aquamarine":{"basePricePerCaratUsd":"300","colors":["blue","deep blue","greenish blue"],"colorGrades":["dark","medium","light"]}},"caratAnchors":[{"microCarats":"500000","multiplierPpm":"550000"},{"microCarats":"1000000","multiplierPpm":"1000000"},{"microCarats":"2000000","multiplierPpm":"2400000"},{"microCarats":"3000000","multiplierPpm":"4200000"},{"microCarats":"5000000","multiplierPpm":"9000000"},{"microCarats":"30000000","multiplierPpm":"9000000"}],"clarityPpm":{"dcl":"50000","i3":"200000","i2":"300000","i1":"500000","si2":"750000","si1":"1000000","vs":"1150000","vvs":"1450000"},"treatmentPpm":{"heated":"600000","minor heat":"850000","unheated":"1200000","oiled":"750000","no oil":"1150000"},"shapes":["cabochon","cushion","emerald cut","marquise","oval","pear","round","diamond cut"],"deltaPpm":{"shape":"500000","color":"500000","colorGrade":"500000"},"demandPriorCount":"1","criterionClampPpm":{"min":"750000","max":"1300000"},"totalClampPpm":{"min":"700000","max":"1500000"},"priceClampUsd":{"min":"100","max":"250000"}}$matrix$::jsonb,
  $canonical${"caratAnchors":[{"microCarats":"500000","multiplierPpm":"550000"},{"microCarats":"1000000","multiplierPpm":"1000000"},{"microCarats":"2000000","multiplierPpm":"2400000"},{"microCarats":"3000000","multiplierPpm":"4200000"},{"microCarats":"5000000","multiplierPpm":"9000000"},{"microCarats":"30000000","multiplierPpm":"9000000"}],"clarityPpm":{"dcl":"50000","i1":"500000","i2":"300000","i3":"200000","si1":"1000000","si2":"750000","vs":"1150000","vvs":"1450000"},"criterionClampPpm":{"max":"1300000","min":"750000"},"deltaPpm":{"color":"500000","colorGrade":"500000","shape":"500000"},"demandPriorCount":"1","priceClampUsd":{"max":"250000","min":"100"},"shapes":["cabochon","cushion","emerald cut","marquise","oval","pear","round","diamond cut"],"totalClampPpm":{"max":"1500000","min":"700000"},"treatmentPpm":{"heated":"600000","minor heat":"850000","no oil":"1150000","oiled":"750000","unheated":"1200000"},"varieties":{"aquamarine":{"basePricePerCaratUsd":"300","colorGrades":["dark","medium","light"],"colors":["blue","deep blue","greenish blue"]},"emerald":{"basePricePerCaratUsd":"1000","colorGrades":["bluish green","deep green","light green"],"colors":["green"]},"peridot":{"basePricePerCaratUsd":"200","colorGrades":["dark","medium","light"],"colors":["green"]},"ruby":{"basePricePerCaratUsd":"1500","colorGrades":["dark","medium","light"],"colors":["red"]},"sapphire":{"basePricePerCaratUsd":"1200","colorGrades":["dark","medium","light"],"colors":["blue","purple","gray","green","brown","orange","pink","violet","white","yellow"]},"tourmaline":{"basePricePerCaratUsd":"400","colorGrades":["dark","medium","light"],"colors":["blue","bluish green","greenish blue","orangey red","pink","pinkish red","red","watermelon"]}},"version":"digital-carat-matrix-v3"}$canonical$,
  '0x1d6a9894c9e0aa00a1728e3afd5c6009c2646886bdb4ff8526e0304b646c37aa',
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  now()
from public.protocol_deployments
on conflict (deployment_id, version) do nothing;

create table public.gem_appraisals (
  id uuid primary key default gen_random_uuid(),
  deployment_id text not null references public.protocol_deployments(id) on delete restrict,
  submission_id uuid not null references public.seller_submissions(id) on delete restrict,
  organization_id uuid not null references public.verifier_organizations(id) on delete restrict,
  appraised_by uuid not null,
  graded_inputs jsonb not null,
  demand_snapshot jsonb not null,
  breakdown jsonb not null,
  approved_valuation_usd numeric(78,0) not null check (approved_valuation_usd > 0),
  matrix_version text not null,
  matrix_hash text not null check (matrix_hash ~ '^0x[0-9a-f]{64}$'),
  matrix_document jsonb not null,
  valuation_hash text not null check (valuation_hash ~ '^0x[0-9a-f]{64}$'),
  canonical_payload text not null,
  nonce text not null,
  client_request_id uuid not null,
  primary_image_evidence_id uuid references public.evidence_files(id) on delete restrict,
  supersedes_id uuid references public.gem_appraisals(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (deployment_id, submission_id, valuation_hash),
  unique (deployment_id, submission_id, client_request_id)
);

alter table public.seller_submissions
  add column if not exists bank_received_at timestamptz,
  add column if not exists bank_received_by uuid,
  add column if not exists bank_organization_id uuid references public.verifier_organizations(id) on delete restrict,
  add column if not exists bank_location text,
  add column if not exists bank_custody_started_at timestamptz,
  add column if not exists current_appraisal_id uuid references public.gem_appraisals(id) on delete restrict;

alter table public.seller_submissions
  add constraint seller_bank_receipt_complete check (
    (bank_received_at is null and bank_received_by is null and bank_organization_id is null)
    or
    (bank_received_at is not null and bank_received_by is not null and bank_organization_id is not null
      and bank_location is not null and bank_custody_started_at is not null)
  );

-- One event stream is shared by seller and redemption workflows. Event rows are
-- immutable; a correction is another row pointing at the superseded event.
create table public.workflow_events (
  id uuid primary key default gen_random_uuid(),
  deployment_id text not null references public.protocol_deployments(id) on delete restrict,
  workflow_kind text not null check (workflow_kind in ('seller', 'redemption')),
  workflow_id uuid not null,
  sequence bigint not null check (sequence > 0),
  event_type text not null,
  from_state text,
  to_state text not null,
  actor_profile_id uuid,
  actor_organization_id uuid references public.verifier_organizations(id) on delete restrict,
  actor_capability text not null,
  payload jsonb not null default '{}'::jsonb,
  transaction_hash text check (transaction_hash is null or transaction_hash ~ '^0x[0-9a-f]{64}$'),
  idempotency_key uuid not null,
  supersedes_event_id uuid references public.workflow_events(id) on delete restrict,
  correction_reason text,
  occurred_at timestamptz not null default now(),
  unique (deployment_id, workflow_kind, workflow_id, sequence),
  unique (deployment_id, workflow_kind, workflow_id, idempotency_key),
  check ((supersedes_event_id is null and correction_reason is null)
      or (supersedes_event_id is not null and char_length(correction_reason) between 10 and 2000))
);

create index workflow_events_timeline
  on public.workflow_events(deployment_id, workflow_kind, workflow_id, sequence);

create table public.workflow_projections (
  deployment_id text not null references public.protocol_deployments(id) on delete restrict,
  workflow_kind text not null check (workflow_kind in ('seller', 'redemption')),
  workflow_id uuid not null,
  current_state text not null,
  version bigint not null default 0,
  legacy_baseline boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (deployment_id, workflow_kind, workflow_id)
);

create or replace function public.prevent_operational_history_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Operational history is append-only';
end;
$$;

create or replace function public.guard_valuation_matrix_version()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Valuation matrix history is append-only';
  end if;
  if old.state = new.state then
    if new is distinct from old then
      raise exception 'Valuation matrix history cannot change without a state transition';
    end if;
    return new;
  end if;
  if old.state='draft' and new.state='proposed' then
    if new.proposed_at is null
       or (to_jsonb(new)-array['state','proposed_at'])
          is distinct from (to_jsonb(old)-array['state','proposed_at']) then
      raise exception 'Draft proposal may only set state and proposed_at';
    end if;
  elsif old.state='proposed' and new.state='active' then
    if new.approved_by is null or new.activated_at is null or new.supersedes_id is null
       or (to_jsonb(new)-array['state','approved_by','activated_at','supersedes_id'])
          is distinct from (to_jsonb(old)-array['state','approved_by','activated_at','supersedes_id']) then
      raise exception 'Activation may only set approval provenance';
    end if;
  elsif old.state='active' and new.state='retired' then
    if (to_jsonb(new)-'state') is distinct from (to_jsonb(old)-'state') then
      raise exception 'Retirement may only change state';
    end if;
  else
    raise exception 'Invalid valuation matrix state transition';
  end if;
  return new;
end;
$$;

-- One serialised activation retires the currently active version and promotes
-- exactly the proposal the administrator reviewed.  Keeping this in SQL avoids
-- a gap with no active matrix between two Edge Function round trips.
create or replace function public.activate_valuation_matrix(
  p_deployment_id text,
  p_matrix_id uuid,
  p_expected_active_version text,
  p_approved_by uuid
) returns public.valuation_matrix_versions
language plpgsql security definer set search_path = public as $$
declare
  current_matrix public.valuation_matrix_versions;
  proposed_matrix public.valuation_matrix_versions;
begin
  perform pg_advisory_xact_lock(hashtextextended('valuation-matrix:' || p_deployment_id, 0));

  select * into current_matrix
  from public.valuation_matrix_versions
  where deployment_id = p_deployment_id and state = 'active'
  for update;
  if not found or current_matrix.version <> p_expected_active_version then
    raise exception using errcode = 'DC409', message = 'Active matrix changed; reload before activating';
  end if;

  select * into proposed_matrix
  from public.valuation_matrix_versions
  where deployment_id = p_deployment_id and id = p_matrix_id and state = 'proposed'
  for update;
  if not found then
    raise exception using errcode = 'DC409', message = 'Only a proposed matrix can be activated';
  end if;

  update public.valuation_matrix_versions
  set state = 'retired'
  where id = current_matrix.id;

  update public.valuation_matrix_versions
  set state = 'active', approved_by = p_approved_by, activated_at = now(),
      supersedes_id = current_matrix.id
  where id = proposed_matrix.id
  returning * into proposed_matrix;
  return proposed_matrix;
end;
$$;
create trigger valuation_matrix_history_guard
before update or delete on public.valuation_matrix_versions
for each row execute function public.guard_valuation_matrix_version();
create trigger gem_appraisals_immutable
before update or delete on public.gem_appraisals
for each row execute function public.prevent_operational_history_mutation();
create trigger workflow_events_immutable
before update or delete on public.workflow_events
for each row execute function public.prevent_operational_history_mutation();

-- Atomic compare-and-append. Edge Functions still enforce the role-specific
-- transition graph; this RPC prevents two valid-looking concurrent actions from
-- both advancing the same workflow version.
create or replace function public.append_workflow_event(
  p_deployment_id text,
  p_workflow_kind text,
  p_workflow_id uuid,
  p_expected_version bigint,
  p_expected_state text,
  p_event_type text,
  p_to_state text,
  p_actor_profile_id uuid,
  p_actor_organization_id uuid,
  p_actor_capability text,
  p_payload jsonb,
  p_transaction_hash text,
  p_idempotency_key uuid,
  p_legacy_baseline boolean default false,
  p_supersedes_event_id uuid default null,
  p_correction_reason text default null
) returns public.workflow_events
language plpgsql security definer set search_path = public as $$
declare
  projection public.workflow_projections;
  inserted public.workflow_events;
begin
  insert into public.workflow_projections(
    deployment_id, workflow_kind, workflow_id, current_state, version, legacy_baseline
  ) values (
    p_deployment_id, p_workflow_kind, p_workflow_id,
    coalesce(p_expected_state, p_to_state), 0, p_legacy_baseline
  ) on conflict do nothing;

  select * into projection from public.workflow_projections
  where deployment_id = p_deployment_id
    and workflow_kind = p_workflow_kind
    and workflow_id = p_workflow_id
  for update;

  select * into inserted from public.workflow_events
  where deployment_id = p_deployment_id
    and workflow_kind = p_workflow_kind
    and workflow_id = p_workflow_id
    and idempotency_key = p_idempotency_key;
  if found then
    if inserted.sequence<>p_expected_version+1
       or inserted.from_state is distinct from p_expected_state
       or inserted.to_state<>p_to_state
       or inserted.event_type<>p_event_type
       or inserted.actor_profile_id is distinct from p_actor_profile_id
       or inserted.actor_organization_id is distinct from p_actor_organization_id
       or inserted.actor_capability<>p_actor_capability
       or inserted.payload is distinct from coalesce(p_payload,'{}'::jsonb)
       or inserted.transaction_hash is distinct from p_transaction_hash
       or inserted.supersedes_event_id is distinct from p_supersedes_event_id
       or inserted.correction_reason is distinct from p_correction_reason then
      raise exception using errcode='DC409',message='Idempotency key is bound to a different workflow event';
    end if;
    return inserted;
  end if;

  if projection.version <> p_expected_version
     or projection.current_state is distinct from p_expected_state then
    raise exception using errcode = 'DC409', message = 'Workflow changed; reload before acting';
  end if;

  insert into public.workflow_events(
    deployment_id, workflow_kind, workflow_id, sequence, event_type,
    from_state, to_state, actor_profile_id, actor_organization_id,
    actor_capability, payload, transaction_hash, idempotency_key,
    supersedes_event_id, correction_reason
  ) values (
    p_deployment_id, p_workflow_kind, p_workflow_id, projection.version + 1,
    p_event_type, projection.current_state, p_to_state, p_actor_profile_id,
    p_actor_organization_id, p_actor_capability, coalesce(p_payload, '{}'::jsonb),
    p_transaction_hash, p_idempotency_key, p_supersedes_event_id, p_correction_reason
  ) returning * into inserted;

  update public.workflow_projections
  set current_state = p_to_state, version = version + 1, updated_at = now()
  where deployment_id = p_deployment_id
    and workflow_kind = p_workflow_kind
    and workflow_id = p_workflow_id;
  return inserted;
end;
$$;

revoke all on function public.append_workflow_event(
  text,text,uuid,bigint,text,text,text,uuid,uuid,text,jsonb,text,uuid,boolean,uuid,text
) from public, anon, authenticated;
grant execute on function public.append_workflow_event(
  text,text,uuid,bigint,text,text,text,uuid,uuid,text,jsonb,text,uuid,boolean,uuid,text
) to service_role;

create or replace function public.record_gem_appraisal(
  p_deployment_id text,
  p_submission_id uuid,
  p_organization_id uuid,
  p_appraised_by uuid,
  p_client_request_id uuid,
  p_appraisal jsonb,
  p_expected_version bigint,
  p_expected_state text
) returns public.gem_appraisals
language plpgsql security definer set search_path = public as $$
declare
  submission public.seller_submissions;
  appraisal public.gem_appraisals;
begin
  select * into submission from public.seller_submissions
  where deployment_id = p_deployment_id and id = p_submission_id
  for update;
  if not found then raise exception using errcode = 'DC404', message = 'Submission not found'; end if;

  -- The submission lock serializes same-key retries. Repeat lookup only after
  -- acquiring it so a concurrent first request can commit and be returned.
  select * into appraisal from public.gem_appraisals
  where deployment_id = p_deployment_id and submission_id = p_submission_id
    and client_request_id = p_client_request_id;
  if found then
    if appraisal.organization_id<>p_organization_id
       or appraisal.appraised_by<>p_appraised_by
       or appraisal.graded_inputs is distinct from p_appraisal->'graded_inputs'
       or appraisal.primary_image_evidence_id is distinct from nullif(p_appraisal->>'primary_image_evidence_id','')::uuid then
      raise exception using errcode='DC409',message='Idempotency key is bound to a different appraisal';
    end if;
    return appraisal;
  end if;
  if submission.current_appraisal_id is not null then
    raise exception using errcode = 'DC409', message = 'Submission already has an appraisal';
  end if;

  insert into public.gem_appraisals(
    deployment_id,submission_id,organization_id,appraised_by,client_request_id,
    graded_inputs,demand_snapshot,breakdown,approved_valuation_usd,
    matrix_version,matrix_hash,matrix_document,valuation_hash,canonical_payload,
    nonce,primary_image_evidence_id
  ) values (
    p_deployment_id,p_submission_id,p_organization_id,p_appraised_by,p_client_request_id,
    p_appraisal->'graded_inputs',p_appraisal->'demand_snapshot',p_appraisal->'breakdown',
    (p_appraisal->>'approved_valuation_usd')::numeric,p_appraisal->>'matrix_version',
    p_appraisal->>'matrix_hash',p_appraisal->'matrix_document',p_appraisal->>'valuation_hash',
    p_appraisal->>'canonical_payload',p_appraisal->>'nonce',
    nullif(p_appraisal->>'primary_image_evidence_id','')::uuid
  ) returning * into appraisal;

  update public.seller_submissions set
    current_appraisal_id = appraisal.id,
    verification_provider = (select name from public.verifier_organizations where id=p_organization_id),
    graded_attributes = appraisal.graded_inputs,
    graded_by_organization = p_organization_id,
    graded_by_profile = p_appraised_by,
    graded_at = appraisal.created_at,
    primary_image_evidence_id = coalesce(appraisal.primary_image_evidence_id,primary_image_evidence_id),
    valuation_method = 'matrix-v1',
    approved_valuation_usd = appraisal.approved_valuation_usd,
    valuation_hash = appraisal.valuation_hash,
    valuation_matrix_hash = appraisal.matrix_hash,
    valuation_canonical_payload = appraisal.canonical_payload,
    valuation_nonce = appraisal.nonce,
    status = case when bank_received_at is not null then 'approved' else status end,
    approved_at = case when bank_received_at is not null then now() else approved_at end
  where id = p_submission_id;

  perform public.append_workflow_event(
    p_deployment_id,'seller',p_submission_id,p_expected_version,p_expected_state,
    'gem_appraised','appraised',p_appraised_by,p_organization_id,'gemlab.appraise',
    jsonb_build_object('appraisalId',appraisal.id,'matrixVersion',appraisal.matrix_version,
      'matrixHash',appraisal.matrix_hash,'valuationHash',appraisal.valuation_hash),
    null,p_client_request_id,p_expected_version=0,null,null
  );
  return appraisal;
end;
$$;

create or replace function public.record_bank_receipt(
  p_deployment_id text,
  p_submission_id uuid,
  p_organization_id uuid,
  p_received_by uuid,
  p_received_at timestamptz,
  p_location text,
  p_custody_started_at timestamptz,
  p_reserve_escrow_ends_at timestamptz,
  p_condition_notes text,
  p_matches_declared boolean,
  p_expected_version bigint,
  p_expected_state text,
  p_idempotency_key uuid
) returns public.seller_submissions
language plpgsql security definer set search_path = public as $$
declare submission public.seller_submissions; prior_event public.workflow_events;
begin
  select * into submission from public.seller_submissions
  where deployment_id=p_deployment_id and id=p_submission_id for update;
  if not found then raise exception using errcode='DC404', message='Submission not found'; end if;
  select * into prior_event from public.workflow_events
  where deployment_id=p_deployment_id and workflow_kind='seller' and workflow_id=p_submission_id
    and idempotency_key=p_idempotency_key;
  if found then
    if prior_event.event_type<>'bank_receipt_recorded'
       or prior_event.actor_profile_id<>p_received_by
       or prior_event.actor_organization_id<>p_organization_id
       or prior_event.payload is distinct from jsonb_build_object(
         'receivedAt',p_received_at,'location',p_location,'custodyStartedAt',p_custody_started_at,
         'reserveEscrowEndsAt',p_reserve_escrow_ends_at,'conditionNotes',p_condition_notes,
         'matchesDeclared',p_matches_declared) then
      raise exception using errcode='DC409',message='Idempotency key is bound to a different bank receipt';
    end if;
    return submission;
  end if;
  if submission.current_appraisal_id is null then
    raise exception using errcode='DC409', message='An immutable appraisal is required before bank receipt';
  end if;
  if p_received_at > now() + interval '5 minutes'
     or p_custody_started_at < p_received_at
     or p_custody_started_at > now() + interval '5 minutes'
     or p_reserve_escrow_ends_at <= p_custody_started_at then
    raise exception using errcode='22023', message='Custody dates are inconsistent';
  end if;
  if submission.bank_received_at is not null then
    raise exception using errcode='DC409',message='Bank receipt is already recorded';
  end if;
  update public.seller_submissions set
    bank_received_at=p_received_at,bank_received_by=p_received_by,
    bank_organization_id=p_organization_id,bank_location=p_location,
    bank_custody_started_at=p_custody_started_at,
    reserve_escrow_ends_at=p_reserve_escrow_ends_at,
    custody_received_at=coalesce(custody_received_at,p_received_at),
    custody_received_by=coalesce(custody_received_by,p_received_by),
    custody_organization=coalesce(custody_organization,p_organization_id),
    custody_condition_notes=coalesce(custody_condition_notes,p_condition_notes),
    custody_matches_declared=coalesce(custody_matches_declared,p_matches_declared),
    status='approved',approved_at=now()
  where id=p_submission_id returning * into submission;
  perform public.append_workflow_event(
    p_deployment_id,'seller',p_submission_id,p_expected_version,p_expected_state,
    'bank_receipt_recorded','bank_received',p_received_by,p_organization_id,'bank.receive',
    jsonb_build_object('receivedAt',p_received_at,'location',p_location,
      'custodyStartedAt',p_custody_started_at,
      'reserveEscrowEndsAt',p_reserve_escrow_ends_at,'conditionNotes',p_condition_notes,
      'matchesDeclared',p_matches_declared),null,p_idempotency_key,
    p_expected_version=0,null,null
  );
  return submission;
end;
$$;

revoke all on function public.record_gem_appraisal(text,uuid,uuid,uuid,uuid,jsonb,bigint,text)
  from public,anon,authenticated;
grant execute on function public.record_gem_appraisal(text,uuid,uuid,uuid,uuid,jsonb,bigint,text)
  to service_role;
revoke all on function public.record_bank_receipt(text,uuid,uuid,uuid,timestamptz,text,timestamptz,timestamptz,text,boolean,bigint,text,uuid)
  from public,anon,authenticated;
grant execute on function public.record_bank_receipt(text,uuid,uuid,uuid,timestamptz,text,timestamptz,timestamptz,text,boolean,bigint,text,uuid)
  to service_role;

-- Redemption operational evidence and owner authorization. Plaintext codes are
-- never stored; only a peppered SHA-256 digest and delivery metadata exist.
alter table public.redemption_requests
  add column if not exists client_request_id uuid,
  add column if not exists owner_email text,
  add column if not exists owner_code_hash text,
  add column if not exists owner_code_expires_at timestamptz,
  add column if not exists owner_code_sent_at timestamptz,
  add column if not exists owner_code_attempts integer not null default 0,
  add column if not exists owner_code_locked_until timestamptz,
  add column if not exists proof_digest text,
  add column if not exists proof_version bigint,
  add column if not exists proof_approval_id text,
  add column if not exists proof_approval_version bigint,
  add column if not exists proof_approved_at timestamptz,
  add column if not exists recovery_eligible_at timestamptz,
  add column if not exists collector_commitment text,
  add column if not exists authorized_wallet text,
  add column if not exists authorization_nonce text,
  add column if not exists authorization_expires_at timestamptz,
  add column if not exists authorization_payload jsonb,
  add column if not exists authorization_signature text,
  add column if not exists authorization_authorizer text;

create unique index redemption_requests_client_intent
  on public.redemption_requests(deployment_id,requester_id,client_request_id)
  where client_request_id is not null;

alter table public.redemption_requests
  drop constraint if exists redemption_requests_status_check;
alter table public.redemption_requests
  add constraint redemption_requests_status_check check (status in (
    'draft','committed','onchain_requested','custodian_collected',
    'custodian_dispatched','bank_received','pickup_handover_recorded',
    'pickup_proof_submitted','delivery_proof_submitted',
    'proof_approved','owner_authorized','chain_burned','cancelled','fulfilled'
  ));

create table public.redemption_owner_codes (
  id uuid primary key default gen_random_uuid(),
  deployment_id text not null references public.protocol_deployments(id) on delete restrict,
  redemption_request_id uuid not null references public.redemption_requests(id) on delete restrict,
  generation_id uuid not null default gen_random_uuid(),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  sent_at timestamptz,
  provider_message_id text,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (deployment_id, redemption_request_id, generation_id)
);
create unique index redemption_owner_codes_one_current
  on public.redemption_owner_codes(deployment_id, redemption_request_id)
  where invalidated_at is null;

create table public.redemption_authorization_challenges (
  id uuid primary key default gen_random_uuid(),
  deployment_id text not null references public.protocol_deployments(id) on delete restrict,
  redemption_request_id uuid not null references public.redemption_requests(id) on delete restrict,
  owner_wallet text not null check (owner_wallet ~ '^0x[0-9a-f]{40}$'),
  message text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.verify_redemption_owner_code(
  p_deployment_id text,
  p_request_id uuid,
  p_code_hash text,
  p_consume boolean default false
) returns boolean
language plpgsql security definer set search_path=public as $$
declare
  code_row public.redemption_owner_codes;
  maximum integer;
begin
  select * into code_row from public.redemption_owner_codes
  where deployment_id=p_deployment_id and redemption_request_id=p_request_id
    and invalidated_at is null
  for update;
  if not found or code_row.expires_at <= now()
     or (code_row.locked_until is not null and code_row.locked_until > now()) then
    return false;
  end if;
  select coalesce((value #>> '{}')::integer,5) into maximum
  from public.operational_settings where key='redemption_owner_code_max_attempts';
  maximum := coalesce(maximum,5);
  if code_row.code_hash <> p_code_hash then
    update public.redemption_owner_codes set
      failed_attempts=failed_attempts+1,
      locked_until=case when failed_attempts+1 >= maximum then now()+interval '15 minutes' else locked_until end
    where id=code_row.id;
    return false;
  end if;
  if p_consume then
    update public.redemption_owner_codes set invalidated_at=now() where id=code_row.id;
  end if;
  return true;
end;
$$;

revoke all on function public.verify_redemption_owner_code(text,uuid,text,boolean)
  from public,anon,authenticated;
grant execute on function public.verify_redemption_owner_code(text,uuid,text,boolean)
  to service_role;

create table public.redemption_action_intents (
  id uuid primary key default gen_random_uuid(),
  deployment_id text not null references public.protocol_deployments(id) on delete restrict,
  redemption_request_id uuid not null references public.redemption_requests(id) on delete restrict,
  action text not null,
  idempotency_key uuid not null,
  expected_version bigint not null,
  payload jsonb not null,
  chain_arguments jsonb,
  transaction_hash text check (transaction_hash is null or transaction_hash ~ '^0x[0-9a-f]{64}$'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (deployment_id, redemption_request_id, idempotency_key)
);

create table public.redemption_workflow_assignments (
  id uuid primary key default gen_random_uuid(),
  deployment_id text not null references public.protocol_deployments(id) on delete restrict,
  redemption_request_id uuid not null references public.redemption_requests(id) on delete restrict,
  assignment_role text not null check (assignment_role in ('custodian','bank')),
  organization_id uuid not null references public.verifier_organizations(id) on delete restrict,
  assigned_by uuid not null,
  assigned_at timestamptz not null default now(),
  unique (deployment_id,redemption_request_id,assignment_role)
);

create or replace function public.assign_redemption_workflow(
  p_deployment_id text,
  p_request_id uuid,
  p_custodian_organization_id uuid,
  p_bank_organization_id uuid,
  p_actor_profile_id uuid,
  p_actor_organization_id uuid,
  p_expected_version bigint,
  p_expected_state text,
  p_idempotency_key uuid
) returns public.workflow_events
language plpgsql security definer set search_path=public as $$
declare
  projection public.workflow_projections;
  event_row public.workflow_events;
  existing_org uuid;
begin
  insert into public.workflow_projections(
    deployment_id,workflow_kind,workflow_id,current_state,version,legacy_baseline
  ) values (p_deployment_id,'redemption',p_request_id,p_expected_state,0,true)
  on conflict do nothing;
  select * into projection from public.workflow_projections
  where deployment_id=p_deployment_id and workflow_kind='redemption' and workflow_id=p_request_id
  for update;
  select * into event_row from public.workflow_events
  where deployment_id=p_deployment_id and workflow_kind='redemption'
    and workflow_id=p_request_id and idempotency_key=p_idempotency_key;
  if found then
    if event_row.payload->>'custodianOrganizationId' <> p_custodian_organization_id::text
       or event_row.payload->>'bankOrganizationId' is distinct from p_bank_organization_id::text then
      raise exception using errcode='DC409',message='Idempotency key is bound to different assignments';
    end if;
    return event_row;
  end if;
  if projection.version<>p_expected_version or projection.current_state is distinct from p_expected_state then
    raise exception using errcode='DC409',message='Workflow changed; reload before assigning';
  end if;

  select organization_id into existing_org from public.redemption_workflow_assignments
  where deployment_id=p_deployment_id and redemption_request_id=p_request_id
    and assignment_role='custodian' for update;
  if found and existing_org<>p_custodian_organization_id then
    raise exception using errcode='DC409',message='Custodian is already assigned';
  end if;
  insert into public.redemption_workflow_assignments(
    deployment_id,redemption_request_id,assignment_role,organization_id,assigned_by
  ) values (p_deployment_id,p_request_id,'custodian',p_custodian_organization_id,p_actor_profile_id)
  on conflict do nothing;

  if p_bank_organization_id is not null then
    existing_org := null;
    select organization_id into existing_org from public.redemption_workflow_assignments
    where deployment_id=p_deployment_id and redemption_request_id=p_request_id
      and assignment_role='bank' for update;
    if found and existing_org<>p_bank_organization_id then
      raise exception using errcode='DC409',message='Bank is already assigned';
    end if;
    insert into public.redemption_workflow_assignments(
      deployment_id,redemption_request_id,assignment_role,organization_id,assigned_by
    ) values (p_deployment_id,p_request_id,'bank',p_bank_organization_id,p_actor_profile_id)
    on conflict do nothing;
  end if;

  select * into event_row from public.append_workflow_event(
    p_deployment_id,'redemption',p_request_id,p_expected_version,p_expected_state,
    'organizations_assigned',p_expected_state,p_actor_profile_id,p_actor_organization_id,
    'admin.correct',jsonb_build_object('custodianOrganizationId',p_custodian_organization_id,
      'bankOrganizationId',p_bank_organization_id),null,p_idempotency_key,p_expected_version=0,null,null
  );
  return event_row;
end;
$$;

revoke all on function public.assign_redemption_workflow(text,uuid,uuid,uuid,uuid,uuid,bigint,text,uuid)
  from public,anon,authenticated;
grant execute on function public.assign_redemption_workflow(text,uuid,uuid,uuid,uuid,uuid,bigint,text,uuid)
  to service_role;

create or replace function public.complete_redemption_transition(
  p_deployment_id text,
  p_request_id uuid,
  p_expected_version bigint,
  p_expected_state text,
  p_event_type text,
  p_to_state text,
  p_actor_profile_id uuid,
  p_actor_organization_id uuid,
  p_actor_capability text,
  p_payload jsonb,
  p_transaction_hash text,
  p_idempotency_key uuid,
  p_legacy_baseline boolean default false
) returns public.redemption_requests
language plpgsql security definer set search_path=public as $$
declare
  request_row public.redemption_requests;
  prior_event public.workflow_events;
begin
  select * into request_row from public.redemption_requests
  where deployment_id=p_deployment_id and id=p_request_id for update;
  if not found then raise exception using errcode='DC404',message='Redemption request not found'; end if;

  select * into prior_event from public.workflow_events
  where deployment_id=p_deployment_id and workflow_kind='redemption'
    and workflow_id=p_request_id and idempotency_key=p_idempotency_key;
  if found then
    perform public.append_workflow_event(
      p_deployment_id,'redemption',p_request_id,p_expected_version,p_expected_state,
      p_event_type,p_to_state,p_actor_profile_id,p_actor_organization_id,p_actor_capability,
      coalesce(p_payload,'{}'::jsonb),p_transaction_hash,p_idempotency_key,
      p_legacy_baseline,null,null
    );
    update public.redemption_action_intents set
      transaction_hash=coalesce(p_transaction_hash,transaction_hash),completed_at=coalesce(completed_at,now())
    where deployment_id=p_deployment_id and redemption_request_id=p_request_id
      and idempotency_key=p_idempotency_key;
    return request_row;
  end if;
  if request_row.status <> p_expected_state then
    raise exception using errcode='DC409',message='Redemption changed; reload before acting';
  end if;

  perform public.append_workflow_event(
    p_deployment_id,'redemption',p_request_id,p_expected_version,p_expected_state,
    p_event_type,p_to_state,p_actor_profile_id,p_actor_organization_id,p_actor_capability,
    coalesce(p_payload,'{}'::jsonb),p_transaction_hash,p_idempotency_key,
    p_legacy_baseline,null,null
  );

  update public.redemption_requests set
    status=p_to_state,
    transaction_hash=case when p_event_type='redemption_requested' then p_transaction_hash else transaction_hash end,
    proof_digest=case when p_event_type='fulfillment_proof_rejected' then null
      else coalesce(p_payload->>'proofDigest',proof_digest) end,
    proof_version=coalesce((p_payload->>'proofVersion')::bigint,proof_version),
    proof_approval_id=case when p_event_type='fulfillment_proof_rejected' then null
      else coalesce(p_payload->>'approvalId',proof_approval_id) end,
    proof_approval_version=case when p_event_type='fulfillment_proof_rejected' then null
      else coalesce((p_payload->>'approvalVersion')::bigint,proof_approval_version) end,
    proof_approved_at=case when p_event_type='fulfillment_proof_approved' then now() else proof_approved_at end,
    recovery_eligible_at=case when p_event_type='fulfillment_proof_approved'
      then (p_payload->>'recoveryEligibleAt')::timestamptz else recovery_eligible_at end,
    collector_commitment=coalesce(p_payload->>'collectorCommitment',collector_commitment),
    authorized_wallet=coalesce(p_payload->>'authorizedWallet',authorized_wallet),
    authorization_nonce=coalesce(p_payload->>'authorizationNonce',authorization_nonce),
    authorization_expires_at=coalesce((p_payload->>'authorizationExpiresAt')::timestamptz,authorization_expires_at),
    authorization_payload=coalesce(p_payload->'authorizationPayload',authorization_payload),
    authorization_signature=coalesce(p_payload->>'authorizationSignature',authorization_signature),
    authorization_authorizer=coalesce(p_payload->>'authorizationAuthorizer',authorization_authorizer)
  where id=p_request_id returning * into request_row;
  update public.redemption_action_intents set
    transaction_hash=coalesce(p_transaction_hash,transaction_hash),completed_at=coalesce(completed_at,now())
  where deployment_id=p_deployment_id and redemption_request_id=p_request_id
    and idempotency_key=p_idempotency_key;
  return request_row;
end;
$$;

revoke all on function public.complete_redemption_transition(
  text,uuid,bigint,text,text,text,uuid,uuid,text,jsonb,text,uuid,boolean
) from public,anon,authenticated;
grant execute on function public.complete_redemption_transition(
  text,uuid,bigint,text,text,text,uuid,uuid,text,jsonb,text,uuid,boolean
) to service_role;

create table public.workflow_evidence (
  id uuid primary key default gen_random_uuid(),
  deployment_id text not null references public.protocol_deployments(id) on delete restrict,
  workflow_kind text not null check (workflow_kind in ('seller', 'redemption')),
  workflow_id uuid not null,
  category text not null check (category in (
    'custodian_collection', 'custodian_dispatch', 'bank_receipt', 'bank_handover',
    'courier_delivery', 'proxy_identity', 'admin_correction', 'recovery_evidence'
  )),
  bucket text not null default 'workflow-evidence' check (bucket = 'workflow-evidence'),
  file_name text not null check (char_length(file_name) between 1 and 180),
  object_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  byte_size bigint not null check (byte_size between 1 and 20971520),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid not null,
  uploaded_by_organization uuid references public.verifier_organizations(id) on delete restrict,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.redemption_proxy_nominations (
  id uuid primary key default gen_random_uuid(),
  deployment_id text not null references public.protocol_deployments(id) on delete restrict,
  redemption_request_id uuid not null references public.redemption_requests(id) on delete restrict,
  owner_profile_id uuid not null,
  owner_wallet text not null check (owner_wallet ~ '^0x[0-9a-f]{40}$'),
  proxy_name text not null check (char_length(proxy_name) between 2 and 200),
  proxy_wallet text not null check (proxy_wallet ~ '^0x[0-9a-f]{40}$'),
  collector_commitment text not null check (collector_commitment ~ '^0x[0-9a-f]{64}$'),
  identity_evidence_id uuid not null references public.workflow_evidence(id) on delete restrict,
  owner_signature text not null,
  state text not null default 'pending' check (state in ('pending','approved','rejected','revoked')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (deployment_id, redemption_request_id)
);

create table public.redemption_recovery_proposals (
  id uuid primary key default gen_random_uuid(),
  deployment_id text not null references public.protocol_deployments(id) on delete restrict,
  redemption_request_id uuid not null references public.redemption_requests(id) on delete restrict,
  proposal_hash text not null check (proposal_hash ~ '^0x[0-9a-f]{64}$'),
  evidence_digest text not null check (evidence_digest ~ '^0x[0-9a-f]{64}$'),
  proposed_at timestamptz not null,
  execute_after timestamptz not null,
  required_approvals integer not null check (required_approvals >= 2),
  approvals integer not null default 1 check (approvals >= 1),
  proposed_by uuid not null,
  proposed_by_wallet text not null check (proposed_by_wallet ~ '^0x[0-9a-f]{40}$'),
  state text not null default 'proposed' check (state in ('proposed','approved','executed','rejected')),
  transaction_hash text check (transaction_hash is null or transaction_hash ~ '^0x[0-9a-f]{64}$'),
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (deployment_id, redemption_request_id, proposal_hash)
);
create unique index redemption_recovery_one_active
  on public.redemption_recovery_proposals(deployment_id,redemption_request_id)
  where state in ('proposed','approved');
create table public.redemption_recovery_approvals (
  proposal_id uuid not null references public.redemption_recovery_proposals(id) on delete restrict,
  approver_profile_id uuid not null,
  approver_organization_id uuid not null references public.verifier_organizations(id) on delete restrict,
  approver_wallet text not null check (approver_wallet ~ '^0x[0-9a-f]{40}$'),
  approved_at timestamptz not null default now(),
  primary key (proposal_id, approver_profile_id),
  unique (proposal_id, approver_wallet)
);

create or replace function public.record_recovery_proposal(
  p_deployment_id text,p_request_id uuid,p_proposal_id uuid,p_proposal_hash text,
  p_evidence_digest text,p_proposed_at timestamptz,p_execute_after timestamptz,
  p_required_approvals integer,p_approvals integer,p_actor_profile_id uuid,
  p_actor_organization_id uuid,p_actor_wallet text,p_expected_version bigint,
  p_expected_state text,p_transaction_hash text,p_idempotency_key uuid
) returns public.redemption_requests
language plpgsql security definer set search_path=public as $$
declare existing public.redemption_recovery_proposals; result public.redemption_requests;
  prior_event public.workflow_events;
  current_version bigint;
begin
  select * into prior_event from public.workflow_events
  where deployment_id=p_deployment_id and workflow_kind='redemption'
    and workflow_id=p_request_id and idempotency_key=p_idempotency_key;
  if found then
    if prior_event.event_type<>'recovery_proposed'
       or prior_event.payload->>'proposalHash'<>p_proposal_hash
       or prior_event.payload->>'evidenceDigest'<>p_evidence_digest
       or lower(prior_event.payload->>'recoveryWallet')<>lower(p_actor_wallet)
       or prior_event.transaction_hash is distinct from p_transaction_hash then
      raise exception using errcode='DC409',message='Idempotency key is bound to different recovery input';
    end if;
    select * into result from public.redemption_requests
    where deployment_id=p_deployment_id and id=p_request_id;
    return result;
  end if;
  select * into existing from public.redemption_recovery_proposals
  where deployment_id=p_deployment_id and redemption_request_id=p_request_id
    and proposal_hash=p_proposal_hash for update;
  if found then
    if existing.evidence_digest<>p_evidence_digest or existing.proposed_by_wallet<>lower(p_actor_wallet) then
      raise exception using errcode='DC409',message='Recovery proposal conflicts with stored chain evidence';
    end if;
  else
    insert into public.redemption_recovery_proposals(
      id,deployment_id,redemption_request_id,proposal_hash,evidence_digest,proposed_at,
      execute_after,required_approvals,approvals,proposed_by,proposed_by_wallet,state,transaction_hash
    ) values (
      p_proposal_id,p_deployment_id,p_request_id,p_proposal_hash,p_evidence_digest,p_proposed_at,
      p_execute_after,p_required_approvals,p_approvals,p_actor_profile_id,lower(p_actor_wallet),
      case when p_approvals>=p_required_approvals then 'approved' else 'proposed' end,p_transaction_hash
    );
    existing.id:=p_proposal_id;
  end if;
  insert into public.redemption_recovery_approvals(
    proposal_id,approver_profile_id,approver_organization_id,approver_wallet
  ) values (existing.id,p_actor_profile_id,p_actor_organization_id,lower(p_actor_wallet))
  on conflict do nothing;
  select version into current_version from public.workflow_projections
  where deployment_id=p_deployment_id and workflow_kind='redemption' and workflow_id=p_request_id;
  select * into result from public.complete_redemption_transition(
    p_deployment_id,p_request_id,current_version,p_expected_state,'recovery_proposed',
    p_expected_state,p_actor_profile_id,p_actor_organization_id,'redemption.recover',
    jsonb_build_object('proposalHash',p_proposal_hash,'evidenceDigest',p_evidence_digest,
      'executeAfter',p_execute_after,'requiredApprovals',p_required_approvals,
      'approvals',p_approvals,'recoveryWallet',lower(p_actor_wallet)),
    p_transaction_hash,p_idempotency_key,p_expected_version=0
  );
  update public.redemption_action_intents set transaction_hash=p_transaction_hash,completed_at=now()
  where deployment_id=p_deployment_id and redemption_request_id=p_request_id
    and idempotency_key=p_idempotency_key and action='propose_recovery';
  return result;
end;
$$;

create or replace function public.record_recovery_approval(
  p_deployment_id text,p_request_id uuid,p_proposal_hash text,p_approvals integer,
  p_actor_profile_id uuid,p_actor_organization_id uuid,p_actor_wallet text,
  p_expected_version bigint,p_expected_state text,p_transaction_hash text,p_idempotency_key uuid
) returns public.redemption_requests
language plpgsql security definer set search_path=public as $$
declare proposal public.redemption_recovery_proposals; result public.redemption_requests;
  prior_event public.workflow_events; inserted_count integer; existing_approval public.redemption_recovery_approvals;
  current_version bigint;
begin
  select * into prior_event from public.workflow_events
  where deployment_id=p_deployment_id and workflow_kind='redemption'
    and workflow_id=p_request_id and idempotency_key=p_idempotency_key;
  if found then
    if prior_event.event_type<>'recovery_approved'
       or prior_event.payload->>'proposalHash'<>p_proposal_hash
       or lower(prior_event.payload->>'recoveryWallet')<>lower(p_actor_wallet)
       or prior_event.transaction_hash is distinct from p_transaction_hash then
      raise exception using errcode='DC409',message='Idempotency key is bound to different recovery input';
    end if;
    select * into result from public.redemption_requests
    where deployment_id=p_deployment_id and id=p_request_id;
    return result;
  end if;
  select * into proposal from public.redemption_recovery_proposals
  where deployment_id=p_deployment_id and redemption_request_id=p_request_id
    and proposal_hash=p_proposal_hash for update;
  if not found then raise exception using errcode='DC404',message='Recovery proposal not found'; end if;
  insert into public.redemption_recovery_approvals(
    proposal_id,approver_profile_id,approver_organization_id,approver_wallet
  ) values (proposal.id,p_actor_profile_id,p_actor_organization_id,lower(p_actor_wallet))
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count=0 then
    select * into existing_approval from public.redemption_recovery_approvals
    where proposal_id=proposal.id and approver_profile_id=p_actor_profile_id
      and approver_wallet=lower(p_actor_wallet);
    if not found then
      raise exception using errcode='DC409',message='Recovery requires distinct approver profiles and wallets';
    end if;
  end if;
  update public.redemption_recovery_proposals set approvals=greatest(approvals,p_approvals),
    state=case when greatest(approvals,p_approvals)>=required_approvals then 'approved' else state end
  where id=proposal.id;
  select version into current_version from public.workflow_projections
  where deployment_id=p_deployment_id and workflow_kind='redemption' and workflow_id=p_request_id;
  select * into result from public.complete_redemption_transition(
    p_deployment_id,p_request_id,current_version,p_expected_state,'recovery_approved',
    p_expected_state,p_actor_profile_id,p_actor_organization_id,'redemption.recover',
    jsonb_build_object('proposalHash',p_proposal_hash,'approvals',p_approvals,
      'recoveryWallet',lower(p_actor_wallet)),p_transaction_hash,p_idempotency_key,false
  );
  update public.redemption_action_intents set transaction_hash=p_transaction_hash,completed_at=now()
  where deployment_id=p_deployment_id and redemption_request_id=p_request_id
    and idempotency_key=p_idempotency_key and action='approve_recovery';
  return result;
end;
$$;

create or replace function public.record_recovery_execution(
  p_deployment_id text,p_request_id uuid,p_proposal_hash text,p_executed_at timestamptz,
  p_actor_profile_id uuid,p_actor_organization_id uuid,p_actor_wallet text,
  p_expected_version bigint,p_expected_state text,p_transaction_hash text,p_idempotency_key uuid
) returns public.redemption_requests
language plpgsql security definer set search_path=public as $$
declare proposal public.redemption_recovery_proposals; result public.redemption_requests;
  prior_event public.workflow_events;
  current_version bigint;
begin
  select * into prior_event from public.workflow_events
  where deployment_id=p_deployment_id and workflow_kind='redemption'
    and workflow_id=p_request_id and idempotency_key=p_idempotency_key;
  if found then
    if prior_event.event_type<>'recovery_executed'
       or prior_event.payload->>'proposalHash'<>p_proposal_hash
       or lower(prior_event.payload->>'recoveryWallet')<>lower(p_actor_wallet)
       or prior_event.transaction_hash is distinct from p_transaction_hash then
      raise exception using errcode='DC409',message='Idempotency key is bound to different recovery input';
    end if;
    select * into result from public.redemption_requests
    where deployment_id=p_deployment_id and id=p_request_id;
    return result;
  end if;
  select * into proposal from public.redemption_recovery_proposals
  where deployment_id=p_deployment_id and redemption_request_id=p_request_id
    and proposal_hash=p_proposal_hash for update;
  if not found then raise exception using errcode='DC404',message='Recovery proposal not found'; end if;
  if proposal.approvals<proposal.required_approvals or proposal.execute_after>now() then
    raise exception using errcode='DC409',message='Recovery is not executable';
  end if;
  update public.redemption_recovery_proposals set state='executed',transaction_hash=p_transaction_hash,
    executed_at=p_executed_at where id=proposal.id;
  select version into current_version from public.workflow_projections
  where deployment_id=p_deployment_id and workflow_kind='redemption' and workflow_id=p_request_id;
  select * into result from public.complete_redemption_transition(
    p_deployment_id,p_request_id,current_version,p_expected_state,'recovery_executed',
    'chain_burned',p_actor_profile_id,p_actor_organization_id,'redemption.recover',
    jsonb_build_object('proposalHash',p_proposal_hash,'executedAt',p_executed_at,
      'recoveryWallet',lower(p_actor_wallet)),p_transaction_hash,p_idempotency_key,false
  );
  update public.redemption_action_intents set transaction_hash=p_transaction_hash,completed_at=now()
  where deployment_id=p_deployment_id and redemption_request_id=p_request_id
    and idempotency_key=p_idempotency_key and action='execute_recovery';
  return result;
end;
$$;

revoke all on function public.record_recovery_proposal(text,uuid,uuid,text,text,timestamptz,timestamptz,integer,integer,uuid,uuid,text,bigint,text,text,uuid) from public,anon,authenticated;
grant execute on function public.record_recovery_proposal(text,uuid,uuid,text,text,timestamptz,timestamptz,integer,integer,uuid,uuid,text,bigint,text,text,uuid) to service_role;
revoke all on function public.record_recovery_approval(text,uuid,text,integer,uuid,uuid,text,bigint,text,text,uuid) from public,anon,authenticated;
grant execute on function public.record_recovery_approval(text,uuid,text,integer,uuid,uuid,text,bigint,text,text,uuid) to service_role;
revoke all on function public.record_recovery_execution(text,uuid,text,timestamptz,uuid,uuid,text,bigint,text,text,uuid) from public,anon,authenticated;
grant execute on function public.record_recovery_execution(text,uuid,text,timestamptz,uuid,uuid,text,bigint,text,text,uuid) to service_role;

create table public.operational_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.operational_settings(key, value)
values
  ('redemption_recovery_grace_seconds', '604800'::jsonb),
  ('redemption_owner_code_ttl_seconds', '900'::jsonb),
  ('redemption_owner_code_max_attempts', '5'::jsonb),
  ('redemption_owner_code_resend_seconds', '60'::jsonb)
on conflict (key) do nothing;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'workflow-evidence', 'workflow-evidence', false, 20971520,
  array['application/pdf','image/jpeg','image/png','image/webp']
) on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.valuation_matrix_versions enable row level security;
alter table public.gem_appraisals enable row level security;
alter table public.workflow_events enable row level security;
alter table public.workflow_projections enable row level security;
alter table public.workflow_evidence enable row level security;
alter table public.redemption_proxy_nominations enable row level security;
alter table public.redemption_owner_codes enable row level security;
alter table public.redemption_action_intents enable row level security;
alter table public.redemption_workflow_assignments enable row level security;
alter table public.redemption_authorization_challenges enable row level security;
alter table public.redemption_recovery_proposals enable row level security;
alter table public.redemption_recovery_approvals enable row level security;
alter table public.operational_settings enable row level security;

-- All operational reads/writes go through capability-checking Edge Functions.
revoke all on public.valuation_matrix_versions from anon, authenticated;
revoke all on public.gem_appraisals from anon, authenticated;
revoke all on public.workflow_events from anon, authenticated;
revoke all on public.workflow_projections from anon, authenticated;
revoke all on public.workflow_evidence from anon, authenticated;
revoke all on public.redemption_proxy_nominations from anon, authenticated;
revoke all on public.redemption_owner_codes from anon, authenticated;
revoke all on public.redemption_action_intents from anon, authenticated;
revoke all on public.redemption_workflow_assignments from anon, authenticated;
revoke all on public.redemption_authorization_challenges from anon, authenticated;
revoke all on public.redemption_recovery_proposals from anon, authenticated;
revoke all on public.redemption_recovery_approvals from anon, authenticated;
revoke all on public.operational_settings from anon, authenticated;

revoke all on function public.activate_valuation_matrix(text,uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.activate_valuation_matrix(text,uuid,text,uuid)
  to service_role;

-- No direct Storage policies are granted. Edge Functions mint one-use signed
-- upload URLs only after a capability and workflow-state check.
