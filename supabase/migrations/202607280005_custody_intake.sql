-- Physical custody intake, recorded before a stone can be graded.
--
-- `GemRegistry.confirmCustody` is a mechanical state transition and cannot be
-- separated from activation: `verifyGem` requires `CustodyConfirmed`, and
-- `registerGem` cannot run before grading because the lab chooses the image
-- sealed into the immutable `metadataURI`. So the on-chain call stays inside the
-- atomic sequence, and this records the physical event it attests to.
--
-- Without this the protocol asserted custody the instant a lab approved, with
-- nobody having received anything — and the lab was grading from the seller's
-- photographs, which is precisely what separating claimed from graded attributes
-- exists to prevent.

alter table public.seller_submissions
  drop constraint if exists seller_submissions_status_check;
alter table public.seller_submissions
  add constraint seller_submissions_status_check
  check (
    status in (
      'submitted',
      'in_review',
      -- Evidence accepted; waiting for the stone to physically arrive.
      'awaiting_custody',
      -- In the vault and logged; waiting for a grading lab.
      'awaiting_grading',
      'graded',
      'expert_review',
      'changes_requested',
      'approved',
      'rejected',
      'registered'
    )
  );

-- `custodian` attests that a stone physically arrived. Distinct from `grader`,
-- who assesses it, so the two duties can be held by different people even
-- within one organisation.
alter table public.verifier_members
  drop constraint if exists verifier_members_role_check;
alter table public.verifier_members
  add constraint verifier_members_role_check
  check (role in ('grader', 'org_admin', 'custodian'));

alter table public.seller_submissions
  add column if not exists custody_received_at timestamptz,
  add column if not exists custody_received_by uuid references public.profiles (id),
  add column if not exists custody_organization uuid references public.verifier_organizations (id),
  add column if not exists custody_condition_notes text,
  -- Whether the stone that arrived matches the carat and dimensions the seller
  -- declared. A mismatch is not rejected here: it is surfaced to the grader,
  -- whose measurements are authoritative anyway.
  add column if not exists custody_matches_declared boolean;

comment on column public.seller_submissions.custody_condition_notes is
  'Condition of the stone as received. Operational record, never published.';
comment on column public.seller_submissions.custody_matches_declared is
  'False when the received stone diverges from the seller''s declared attributes. Surfaced to the grader.';

-- An intake record is meaningless without who logged it and when.
alter table public.seller_submissions
  drop constraint if exists seller_submissions_custody_intake_complete;
alter table public.seller_submissions
  add constraint seller_submissions_custody_intake_complete
  check (
    (custody_received_at is null and custody_received_by is null)
    or (custody_received_at is not null and custody_received_by is not null)
  );

create index if not exists seller_submissions_custody_queue
  on public.seller_submissions (status, created_at)
  where custody_received_at is null;
