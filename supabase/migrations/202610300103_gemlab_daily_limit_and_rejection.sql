-- Gem lab controls on the versioned workflow.
--
-- 1. Daily valuation limits. `verifier_organizations.daily_valuation_limit`
--    bounds how much one compromised lab account can price in a day. The legacy
--    grading endpoint enforced it atomically through `record_valuation`
--    (202608170002), but `record_gem_appraisal`, which every Arbitrum appraisal
--    goes through, never checked it. It is redefined here, unchanged except for
--    the limit check, which runs after the idempotent-replay return (a retry of
--    a recorded appraisal consumes nothing) and before the insert.
--
-- 2. Rejection. The retired grade endpoint was the only way to reject a stone,
--    and it answers 410 on deployments that require the client release. This
--    adds the versioned counterpart: one transaction that refuses the stone and
--    appends the `gem_rejected` workflow event, exactly as an appraisal does.

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
  allowed integer;
  used bigint;
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

  -- The organisation's rolling 24-hour allowance, counted and consumed under
  -- one per-organisation advisory lock. The key is the one `record_valuation`
  -- takes, so the legacy grading path and this one serialise against each
  -- other, and both kinds of valuation count towards the same limit.
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 0));
  select daily_valuation_limit into allowed
  from public.verifier_organizations
  where id = p_organization_id and active;
  if allowed is null then
    raise exception using errcode = '42501', message = 'Verifier organisation is not active';
  end if;
  select
    (select count(*) from public.gem_appraisals
      where organization_id = p_organization_id
        and created_at >= now() - interval '24 hours')
    + (select count(*) from public.valuations
      where organization_id = p_organization_id
        and created_at >= now() - interval '24 hours')
  into used;
  if used >= allowed then
    raise exception using errcode = 'DC001',
      message = format('Daily valuation limit of %s reached for this organization', allowed);
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

revoke all on function public.record_gem_appraisal(text,uuid,uuid,uuid,uuid,jsonb,bigint,text)
  from public,anon,authenticated;
grant execute on function public.record_gem_appraisal(text,uuid,uuid,uuid,uuid,jsonb,bigint,text)
  to service_role;

create or replace function public.reject_gem_submission(
  p_deployment_id text,
  p_submission_id uuid,
  p_organization_id uuid,
  p_rejected_by uuid,
  p_reason text,
  p_expected_version bigint,
  p_expected_state text,
  p_idempotency_key uuid
) returns public.seller_submissions
language plpgsql security definer set search_path = public as $$
declare
  submission public.seller_submissions;
  prior_event public.workflow_events;
  reason text := btrim(coalesce(p_reason, ''));
begin
  select * into submission from public.seller_submissions
  where deployment_id = p_deployment_id and id = p_submission_id
  for update;
  if not found then raise exception using errcode = 'DC404', message = 'Submission not found'; end if;

  -- Same-key retries return the recorded rejection instead of failing on the
  -- status it already moved to.
  select * into prior_event from public.workflow_events
  where deployment_id = p_deployment_id and workflow_kind = 'seller'
    and workflow_id = p_submission_id and idempotency_key = p_idempotency_key;
  if found then
    if prior_event.event_type <> 'gem_rejected'
       or prior_event.actor_profile_id is distinct from p_rejected_by
       or prior_event.actor_organization_id is distinct from p_organization_id
       or prior_event.payload is distinct from jsonb_build_object('reason', reason) then
      raise exception using errcode = 'DC409', message = 'Idempotency key is bound to a different workflow event';
    end if;
    return submission;
  end if;

  if char_length(reason) < 10 or char_length(reason) > 2000 then
    raise exception using errcode = '22023', message = 'A rejection reason of 10 to 2000 characters is required';
  end if;
  -- Only before an appraisal: once priced, the stone has moved on to the bank
  -- and the administrator, and nothing reaches the chain before then anyway.
  if submission.status not in ('awaiting_custody', 'awaiting_grading')
     or submission.current_appraisal_id is not null then
    raise exception using errcode = 'DC409', message = 'Only a stone awaiting appraisal can be rejected';
  end if;

  update public.seller_submissions set
    status = 'rejected',
    verification_provider = (select name from public.verifier_organizations where id = p_organization_id),
    rejection_reason = reason,
    rejected_by_organization = p_organization_id,
    rejected_by_profile = p_rejected_by,
    rejected_at = now()
  where id = p_submission_id
  returning * into submission;

  perform public.append_workflow_event(
    p_deployment_id, 'seller', p_submission_id, p_expected_version, p_expected_state,
    'gem_rejected', 'rejected', p_rejected_by, p_organization_id, 'gemlab.appraise',
    jsonb_build_object('reason', reason), null, p_idempotency_key,
    p_expected_version = 0, null, null
  );
  return submission;
end;
$$;

revoke all on function public.reject_gem_submission(text,uuid,uuid,uuid,text,bigint,text,uuid)
  from public, anon, authenticated;
grant execute on function public.reject_gem_submission(text,uuid,uuid,uuid,text,bigint,text,uuid)
  to service_role;
