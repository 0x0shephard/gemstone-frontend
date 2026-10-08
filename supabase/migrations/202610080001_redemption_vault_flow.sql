-- Redemption runs through the custodian vault in six steps (see
-- supabase/functions/_shared/redemptionFlow.ts):
--   onchain_requested -> accepted (Digital Carat accepts) -> custodian_collected
--   -> custodian_dispatched -> arrived -> proof_approved (server approval, code
--   emailed) -> owner_authorized (holder confirms with the code) -> chain_burned.
-- The bank / proof-review states stay valid so rows already in them can finish.

alter table public.redemption_requests
  drop constraint if exists redemption_requests_status_check;
alter table public.redemption_requests
  add constraint redemption_requests_status_check check (status in (
    'draft','committed','onchain_requested','accepted','custodian_collected',
    'custodian_dispatched','arrived','bank_received','pickup_handover_recorded',
    'pickup_proof_submitted','delivery_proof_submitted',
    'proof_approved','owner_authorized','chain_burned','cancelled','fulfilled'
  ));

-- Evidence the vault uploads when the stone reaches the pickup point or the
-- holder's delivery address.
alter table public.workflow_evidence
  drop constraint if exists workflow_evidence_category_check;
alter table public.workflow_evidence
  add constraint workflow_evidence_category_check check (category in (
    'custodian_collection', 'custodian_dispatch', 'bank_receipt', 'bank_handover',
    'courier_delivery', 'redemption_arrival', 'proxy_identity', 'admin_correction',
    'recovery_evidence'
  ));
