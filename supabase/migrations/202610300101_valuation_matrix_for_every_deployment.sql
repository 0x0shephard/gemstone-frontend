-- Every protocol deployment gets the active valuation matrix it needs.
--
-- `202610030001_operational_lifecycles.sql` seeded `digital-carat-matrix-v3`
-- with `insert ... select from protocol_deployments`, which covers only the
-- deployments that existed when it ran. `arbitrum-one-519342582` was staged
-- later, so it has no matrix row at all: appraisals fell back to the in-code
-- matrix with no registry id, and `activate_valuation_matrix` refuses to
-- promote a proposal because there is no active version to supersede.
--
-- The seed now lives in one function, used twice: once below to backfill every
-- deployment that has no active matrix, and from a trigger so that every future
-- `protocol_deployments` insert (each staging migration) gets one in the same
-- transaction. The document, canonical form and hash are byte-for-byte the v3
-- snapshot from 202610030001, whose hash matches VALUATION_MATRIX in
-- `_shared/valuationMatrix.ts`.

create or replace function public.seed_default_valuation_matrix(p_deployment_id text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  -- A deployment that already has an active matrix keeps it, whatever version
  -- it is. Seeding a second active row would violate valuation_matrix_one_active.
  if exists (
    select 1 from public.valuation_matrix_versions
    where deployment_id = p_deployment_id and state = 'active'
  ) then
    return;
  end if;

  insert into public.valuation_matrix_versions(
    deployment_id, version, state, matrix_document, canonical_document,
    matrix_hash, created_by, approved_by, activated_at
  ) values (
    p_deployment_id,
    'digital-carat-matrix-v3',
    'active',
    $matrix${"version":"digital-carat-matrix-v3","varieties":{"emerald":{"basePricePerCaratUsd":"1000","colors":["green"],"colorGrades":["bluish green","deep green","light green"]},"sapphire":{"basePricePerCaratUsd":"1200","colors":["blue","purple","gray","green","brown","orange","pink","violet","white","yellow"],"colorGrades":["dark","medium","light"]},"ruby":{"basePricePerCaratUsd":"1500","colors":["red"],"colorGrades":["dark","medium","light"]},"peridot":{"basePricePerCaratUsd":"200","colors":["green"],"colorGrades":["dark","medium","light"]},"tourmaline":{"basePricePerCaratUsd":"400","colors":["blue","bluish green","greenish blue","orangey red","pink","pinkish red","red","watermelon"],"colorGrades":["dark","medium","light"]},"aquamarine":{"basePricePerCaratUsd":"300","colors":["blue","deep blue","greenish blue"],"colorGrades":["dark","medium","light"]}},"caratAnchors":[{"microCarats":"500000","multiplierPpm":"550000"},{"microCarats":"1000000","multiplierPpm":"1000000"},{"microCarats":"2000000","multiplierPpm":"2400000"},{"microCarats":"3000000","multiplierPpm":"4200000"},{"microCarats":"5000000","multiplierPpm":"9000000"},{"microCarats":"30000000","multiplierPpm":"9000000"}],"clarityPpm":{"dcl":"50000","i3":"200000","i2":"300000","i1":"500000","si2":"750000","si1":"1000000","vs":"1150000","vvs":"1450000"},"treatmentPpm":{"heated":"600000","minor heat":"850000","unheated":"1200000","oiled":"750000","no oil":"1150000"},"shapes":["cabochon","cushion","emerald cut","marquise","oval","pear","round","diamond cut"],"deltaPpm":{"shape":"500000","color":"500000","colorGrade":"500000"},"demandPriorCount":"1","criterionClampPpm":{"min":"750000","max":"1300000"},"totalClampPpm":{"min":"700000","max":"1500000"},"priceClampUsd":{"min":"100","max":"250000"}}$matrix$::jsonb,
    $canonical${"caratAnchors":[{"microCarats":"500000","multiplierPpm":"550000"},{"microCarats":"1000000","multiplierPpm":"1000000"},{"microCarats":"2000000","multiplierPpm":"2400000"},{"microCarats":"3000000","multiplierPpm":"4200000"},{"microCarats":"5000000","multiplierPpm":"9000000"},{"microCarats":"30000000","multiplierPpm":"9000000"}],"clarityPpm":{"dcl":"50000","i1":"500000","i2":"300000","i3":"200000","si1":"1000000","si2":"750000","vs":"1150000","vvs":"1450000"},"criterionClampPpm":{"max":"1300000","min":"750000"},"deltaPpm":{"color":"500000","colorGrade":"500000","shape":"500000"},"demandPriorCount":"1","priceClampUsd":{"max":"250000","min":"100"},"shapes":["cabochon","cushion","emerald cut","marquise","oval","pear","round","diamond cut"],"totalClampPpm":{"max":"1500000","min":"700000"},"treatmentPpm":{"heated":"600000","minor heat":"850000","no oil":"1150000","oiled":"750000","unheated":"1200000"},"varieties":{"aquamarine":{"basePricePerCaratUsd":"300","colorGrades":["dark","medium","light"],"colors":["blue","deep blue","greenish blue"]},"emerald":{"basePricePerCaratUsd":"1000","colorGrades":["bluish green","deep green","light green"],"colors":["green"]},"peridot":{"basePricePerCaratUsd":"200","colorGrades":["dark","medium","light"],"colors":["green"]},"ruby":{"basePricePerCaratUsd":"1500","colorGrades":["dark","medium","light"],"colors":["red"]},"sapphire":{"basePricePerCaratUsd":"1200","colorGrades":["dark","medium","light"],"colors":["blue","purple","gray","green","brown","orange","pink","violet","white","yellow"]},"tourmaline":{"basePricePerCaratUsd":"400","colorGrades":["dark","medium","light"],"colors":["blue","bluish green","greenish blue","orangey red","pink","pinkish red","red","watermelon"]}},"version":"digital-carat-matrix-v3"}$canonical$,
    '0x1d6a9894c9e0aa00a1728e3afd5c6009c2646886bdb4ff8526e0304b646c37aa',
    '00000000-0000-0000-0000-000000000000'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    now()
  )
  on conflict do nothing;
end;
$$;

revoke all on function public.seed_default_valuation_matrix(text) from public, anon, authenticated;
grant execute on function public.seed_default_valuation_matrix(text) to service_role;

create or replace function public.seed_valuation_matrix_for_new_deployment()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_default_valuation_matrix(new.id);
  return new;
end;
$$;

drop trigger if exists protocol_deployment_seeds_valuation_matrix on public.protocol_deployments;
create trigger protocol_deployment_seeds_valuation_matrix
after insert on public.protocol_deployments
for each row execute function public.seed_valuation_matrix_for_new_deployment();

-- Backfill. Idempotent: deployments with an active matrix are skipped, and the
-- insert itself does nothing on any unique conflict.
select public.seed_default_valuation_matrix(id) from public.protocol_deployments;
