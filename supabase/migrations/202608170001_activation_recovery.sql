-- Making activation recovery deterministic.
--
-- `registerGem` is not idempotent and the registry enforces no uniqueness on
-- certificate hash or metadata URI, so registering the same stone twice creates
-- two gems for one physical object. The only thing standing between a retry and
-- that outcome is the ability to find the first registration.
--
-- Recovery searched the last 128 blocks — about twenty-five minutes on Sepolia.
-- A registration that landed on chain while the write recording its id failed
-- was therefore recoverable only if someone retried within the window, and
-- silently duplicated afterwards.

alter table public.seller_submissions
  -- Written before the registration is broadcast, so a scan has a floor that
  -- does not depend on how long ago the attempt was. The transaction hash is
  -- the precise answer; this is what remains when the process dies between
  -- broadcasting and recording it.
  add column if not exists registration_scan_from_block bigint;

comment on column public.seller_submissions.registration_scan_from_block is
  'Chain height immediately before registerGem was first broadcast. Bounds the recovery scan from below without assuming the retry is prompt.';
