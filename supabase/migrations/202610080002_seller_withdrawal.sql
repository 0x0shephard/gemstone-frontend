-- A seller may withdraw their own submission until activation reaches the chain
-- (see supabase/functions/_shared/sellerWithdrawal.ts).
alter table public.seller_submissions
  drop constraint if exists seller_submissions_status_check;
alter table public.seller_submissions
  add constraint seller_submissions_status_check
  check (
    status in (
      'submitted',
      'in_review',
      'awaiting_custody',
      'awaiting_grading',
      'graded',
      'expert_review',
      'changes_requested',
      'approved',
      'rejected',
      'registered',
      'withdrawn'
    )
  );
