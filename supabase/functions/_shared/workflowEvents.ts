import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { OperationalMembership } from './operations.ts';

export type WorkflowKind = 'seller' | 'redemption';

export interface WorkflowProjection {
  deployment_id: string;
  workflow_kind: WorkflowKind;
  workflow_id: string;
  current_state: string;
  version: number | string;
  legacy_baseline: boolean;
  updated_at: string;
}

export async function loadProjection(
  admin: SupabaseClient,
  deploymentId: string,
  kind: WorkflowKind,
  workflowId: string,
): Promise<WorkflowProjection | null> {
  const { data, error } = await admin
    .from('workflow_projections')
    .select('*')
    .eq('deployment_id', deploymentId)
    .eq('workflow_kind', kind)
    .eq('workflow_id', workflowId)
    .maybeSingle();
  if (error) throw error;
  return (data as WorkflowProjection | null) ?? null;
}

export async function appendWorkflowEvent(input: {
  admin: SupabaseClient;
  deploymentId: string;
  kind: WorkflowKind;
  workflowId: string;
  expectedVersion: number;
  expectedState: string;
  eventType: string;
  toState: string;
  actor: OperationalMembership | { profileId: string; organizationId?: null };
  capability: string;
  payload?: Record<string, unknown>;
  transactionHash?: string | null;
  idempotencyKey: string;
  legacyBaseline?: boolean;
  supersedesEventId?: string | null;
  correctionReason?: string | null;
}) {
  const { data, error } = await input.admin.rpc('append_workflow_event', {
    p_deployment_id: input.deploymentId,
    p_workflow_kind: input.kind,
    p_workflow_id: input.workflowId,
    p_expected_version: input.expectedVersion,
    p_expected_state: input.expectedState,
    p_event_type: input.eventType,
    p_to_state: input.toState,
    p_actor_profile_id: input.actor.profileId,
    p_actor_organization_id:
      'organizationId' in input.actor ? (input.actor.organizationId ?? null) : null,
    p_actor_capability: input.capability,
    p_payload: input.payload ?? {},
    p_transaction_hash: input.transactionHash ?? null,
    p_idempotency_key: input.idempotencyKey,
    p_legacy_baseline: input.legacyBaseline ?? false,
    p_supersedes_event_id: input.supersedesEventId ?? null,
    p_correction_reason: input.correctionReason ?? null,
  });
  if (error) throw error;
  return data;
}

export async function workflowTimeline(
  admin: SupabaseClient,
  deploymentId: string,
  kind: WorkflowKind,
  workflowId: string,
) {
  const { data, error } = await admin
    .from('workflow_events')
    .select(
      'id,sequence,event_type,from_state,to_state,actor_capability,payload,transaction_hash,supersedes_event_id,correction_reason,occurred_at',
    )
    .eq('deployment_id', deploymentId)
    .eq('workflow_kind', kind)
    .eq('workflow_id', workflowId)
    .order('sequence');
  if (error) throw error;
  return data ?? [];
}

/**
 * User/staff projection: keep immutable corrections in storage, but hide the
 * visibly replaced event and the administrator's internal correction reason.
 * Admin audit views continue to call `workflowTimeline` directly.
 */
export async function effectiveWorkflowTimeline(
  admin: SupabaseClient,
  deploymentId: string,
  kind: WorkflowKind,
  workflowId: string,
) {
  const rows = await workflowTimeline(admin, deploymentId, kind, workflowId);
  const superseded = new Set(
    rows.flatMap((row) => (row.supersedes_event_id ? [row.supersedes_event_id] : [])),
  );
  return rows
    .filter((row) => !superseded.has(row.id))
    .map(({ correction_reason: _reason, ...row }) => ({
      ...row,
      correction_reason: null,
    }));
}
