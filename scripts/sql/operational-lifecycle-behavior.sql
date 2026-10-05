\set ON_ERROR_STOP on

do $$
declare
  deployment text := public.current_protocol_deployment_id();
  owner_id uuid := '10000000-0000-0000-0000-000000000001';
  request_id uuid := '20000000-0000-0000-0000-000000000001';
  intent_id uuid := '30000000-0000-0000-0000-000000000001';
  idempotency_id uuid := '40000000-0000-0000-0000-000000000001';
  transition_key uuid := '50000000-0000-0000-0000-000000000001';
  matrix_id uuid;
  result public.redemption_requests;
  tamper_rejected boolean := false;
  operational_tables text[] := array[
    'valuation_matrix_versions', 'gem_appraisals', 'workflow_events',
    'workflow_projections', 'redemption_owner_codes',
    'redemption_authorization_challenges', 'redemption_action_intents',
    'redemption_workflow_assignments', 'workflow_evidence',
    'redemption_proxy_nominations', 'redemption_recovery_proposals',
    'redemption_recovery_approvals', 'operational_settings'
  ];
begin
  if (
    select count(*)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = any(operational_tables)
      and c.relkind = 'r' and c.relrowsecurity
  ) <> cardinality(operational_tables) then
    raise exception 'Every operational table must exist with RLS enabled';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated') and table_schema = 'public'
      and table_name = any(operational_tables)
  ) then
    raise exception 'anon/authenticated unexpectedly have operational table privileges';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'append_workflow_event', 'record_gem_appraisal', 'record_bank_receipt',
        'verify_redemption_owner_code', 'assign_redemption_workflow',
        'complete_redemption_transition', 'record_recovery_proposal',
        'record_recovery_approval', 'record_recovery_execution',
        'activate_valuation_matrix'
      ])
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) then
    raise exception 'anon/authenticated unexpectedly can execute a privileged RPC';
  end if;

  insert into auth.users(id, email, raw_user_meta_data)
  values (owner_id, 'migration-check@example.invalid', '{"full_name":"Migration Check"}')
  on conflict (id) do nothing;

  -- Active matrix provenance is append-only, including same-state updates.
  select id into matrix_id
  from public.valuation_matrix_versions
  where state = 'active'
  order by activated_at desc nulls last
  limit 1;
  if matrix_id is null then
    raise exception 'Expected the exact matrix-v3 seed to be active';
  end if;
  begin
    update public.valuation_matrix_versions
    set matrix_document = matrix_document || '{"tampered":true}'::jsonb
    where id = matrix_id;
  exception
    when raise_exception then tamper_rejected := true;
  end;
  if not tamper_rejected then
    raise exception 'Matrix same-state tamper unexpectedly succeeded';
  end if;

  insert into public.workflow_projections(
    deployment_id, workflow_kind, workflow_id, current_state, version
  ) values (deployment, 'seller', request_id, 'submitted', 0);

  perform public.append_workflow_event(
    deployment, 'seller', request_id, 0, 'submitted', 'seller_received', 'awaiting_grading',
    owner_id, null, 'test.write', '{"value":1}'::jsonb, null,
    idempotency_id, false, null, null
  );
  perform public.append_workflow_event(
    deployment, 'seller', request_id, 0, 'submitted', 'seller_received', 'awaiting_grading',
    owner_id, null, 'test.write', '{"value":1}'::jsonb, null,
    idempotency_id, false, null, null
  );
  begin
    perform public.append_workflow_event(
      deployment, 'seller', request_id, 0, 'submitted', 'seller_received', 'awaiting_grading',
      owner_id, null, 'test.write', '{"value":2}'::jsonb, null,
      idempotency_id, false, null, null
    );
    raise exception 'Changed workflow event reused an idempotency key';
  exception
    when sqlstate 'DC409' then null;
  end;

  insert into public.redemption_requests(
    id, requester_id, requester_wallet, gem_id, token_id,
    fulfillment_method, fulfillment_details, status, deployment_id
  ) values (
    request_id, owner_id, '0x1111111111111111111111111111111111111111',
    1, 1, 'pickup', '{"pickupLocation":"Test bank"}', 'committed', deployment
  );
  delete from public.workflow_projections
  where deployment_id = deployment and workflow_kind = 'redemption' and workflow_id = request_id;
  insert into public.workflow_projections(
    deployment_id, workflow_kind, workflow_id, current_state, version
  ) values (deployment, 'redemption', request_id, 'committed', 0);
  insert into public.redemption_action_intents(
    id, deployment_id, redemption_request_id, action, idempotency_key,
    expected_version, payload, chain_arguments, transaction_hash
  ) values (
    intent_id, deployment, request_id, 'mark_onchain_requested', transition_key,
    0, '{"requestHash":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
    '{}'::jsonb,
    '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  );

  select * into result from public.complete_redemption_transition(
    deployment, request_id, 0, 'committed', 'redemption_requested',
    'onchain_requested', owner_id, null, 'redemption.owner',
    '{"requestHash":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
    '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    transition_key, false
  );
  if result.status <> 'onchain_requested' then
    raise exception 'Redemption transition did not persist';
  end if;
  if not exists (
    select 1 from public.redemption_action_intents
    where id = intent_id and completed_at is not null
      and transaction_hash = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  ) then
    raise exception 'Transition and intent completion were not atomic';
  end if;

  -- Exact response-loss retry succeeds even after state advancement.
  perform public.complete_redemption_transition(
    deployment, request_id, 0, 'committed', 'redemption_requested',
    'onchain_requested', owner_id, null, 'redemption.owner',
    '{"requestHash":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
    '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    transition_key, false
  );
  begin
    perform public.complete_redemption_transition(
      deployment, request_id, 0, 'committed', 'redemption_requested',
      'onchain_requested', owner_id, null, 'redemption.owner',
      '{"requestHash":"0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}',
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      transition_key, false
    );
    raise exception 'Changed transition reused an idempotency key';
  exception
    when sqlstate 'DC409' then null;
  end;
end
$$;

select 'operational-lifecycle-sql-ok' as result;
