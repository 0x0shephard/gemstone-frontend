import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { capabilitiesFor } from './operations';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/202610030001_operational_lifecycles.sql'),
  'utf8',
);
const redemptionLifecycle = readFileSync(
  join(process.cwd(), 'supabase/functions/v1-redemption-lifecycle/index.ts'),
  'utf8',
);

describe('operational capability matrix', () => {
  it('reserves global admin decisions for an admin organization administrator', () => {
    for (const role of [
      'grader',
      'gemologist',
      'bank_operator',
      'custody_operator',
      'custodian',
    ] as const) {
      expect(capabilitiesFor('admin', role)).not.toContain('matrix.activate');
      expect(capabilitiesFor('admin', role)).not.toContain('redemption.approve');
      expect(capabilitiesFor('admin', role)).not.toContain('admin.correct');
    }
    expect(capabilitiesFor('admin', 'org_admin')).toEqual(
      expect.arrayContaining(['matrix.activate', 'redemption.approve', 'admin.correct']),
    );
  });

  it('does not infer bank or custody authority from organization kind alone', () => {
    expect(capabilitiesFor('bank', 'gemologist')).toEqual([]);
    expect(capabilitiesFor('bank', 'custodian')).toEqual([]);
    expect(capabilitiesFor('custodian', 'bank_operator')).toEqual([]);
    expect(capabilitiesFor('custodian', 'grader')).toEqual([]);
    expect(capabilitiesFor('bank', 'bank_operator')).toEqual(['bank.receive']);
    expect(capabilitiesFor('custodian', 'custody_operator')).toEqual(['custodian.fulfill']);
  });

  it('allows appraisal and proposal only to the intended lab roles', () => {
    expect(capabilitiesFor('gemlab', 'gemologist')).toEqual(['gemlab.read', 'gemlab.appraise']);
    expect(capabilitiesFor('gemlab', 'org_admin')).toContain('matrix.propose');
    expect(capabilitiesFor('gemlab', 'bank_operator')).toEqual([]);
  });

  it('binds seller retries to immutable persisted appraisal and receipt input', () => {
    expect(migration).toContain('Idempotency key is bound to a different appraisal');
    expect(migration).toContain('Idempotency key is bound to a different bank receipt');
    expect(migration).toContain(
      "appraisal.graded_inputs is distinct from p_appraisal->'graded_inputs'",
    );
    expect(migration).toContain(
      "appraisal.primary_image_evidence_id is distinct from nullif(p_appraisal->>'primary_image_evidence_id','')::uuid",
    );
    expect(migration).toContain('prior_event.actor_organization_id<>p_organization_id');
    expect(migration).toContain("'matchesDeclared',p_matches_declared");
    const appraisalFunction = migration.slice(
      migration.indexOf('function public.record_gem_appraisal'),
      migration.indexOf('function public.record_bank_receipt'),
    );
    expect(appraisalFunction.indexOf('for update')).toBeLessThan(
      appraisalFunction.indexOf('client_request_id = p_client_request_id'),
    );
  });

  it('persists recovery proposal, approval, workflow event, and intent atomically', () => {
    for (const action of ['proposal', 'approval', 'execution']) {
      expect(migration).toContain(`function public.record_recovery_${action}`);
    }
    expect(migration.match(/completed_at=now\(\)/g)).toHaveLength(3);
    expect(migration).toContain(
      "and idempotency_key=p_idempotency_key and action='propose_recovery'",
    );
    expect(migration).toContain(
      "and idempotency_key=p_idempotency_key and action='approve_recovery'",
    );
    expect(migration).toContain(
      "and idempotency_key=p_idempotency_key and action='execute_recovery'",
    );
    expect(migration).toContain('Recovery requires distinct approver profiles and wallets');
    expect(migration).toContain('create unique index redemption_recovery_one_active');
  });

  it('allows only exact matrix lifecycle provenance changes', () => {
    expect(migration).toContain(
      'Valuation matrix history cannot change without a state transition',
    );
    expect(migration).toContain("to_jsonb(new)-array['state','proposed_at']");
    expect(migration).toContain(
      "to_jsonb(new)-array['state','approved_by','activated_at','supersedes_id']",
    );
    expect(migration).toContain("(to_jsonb(new)-'state') is distinct from (to_jsonb(old)-'state')");
  });

  it('assigns redemption organizations under one projection lock and validates retry payloads', () => {
    const start = migration.indexOf('function public.assign_redemption_workflow');
    const end = migration.indexOf('revoke all on function public.assign_redemption_workflow');
    const assignment = migration.slice(start, end);
    expect(assignment).toContain('for update');
    expect(assignment).toContain('Idempotency key is bound to different assignments');
    expect(assignment).toContain("assignment_role='custodian'");
    expect(assignment).toContain("assignment_role='bank'");
    expect(assignment.indexOf('projection.version<>p_expected_version')).toBeLessThan(
      assignment.indexOf('insert into public.redemption_workflow_assignments'),
    );
  });

  it('binds generic workflow retry keys and completes action intents in the same SQL RPC', () => {
    expect(migration).toContain('Idempotency key is bound to a different workflow event');
    for (const field of [
      'inserted.event_type<>p_event_type',
      'inserted.actor_capability<>p_actor_capability',
      "inserted.payload is distinct from coalesce(p_payload,'{}'::jsonb)",
      'inserted.transaction_hash is distinct from p_transaction_hash',
      'inserted.supersedes_event_id is distinct from p_supersedes_event_id',
    ]) {
      expect(migration).toContain(field);
    }
    const transition = migration.slice(
      migration.indexOf('function public.complete_redemption_transition'),
      migration.indexOf('create table public.workflow_evidence'),
    );
    expect(transition.match(/update public\.redemption_action_intents/g)).toHaveLength(2);
    expect(transition).toContain('completed_at=coalesce(completed_at,now())');
  });

  it('returns persisted fulfillment assignments from canonical lifecycle detail', () => {
    const detail = redemptionLifecycle.slice(
      redemptionLifecycle.indexOf("if (action === 'detail')"),
      redemptionLifecycle.indexOf("if (action === 'resume_action_intent')"),
    );
    expect(detail).toContain(".from('redemption_workflow_assignments')");
    expect(detail).toContain("storedAssignment.assignment_role === 'custodian'");
    expect(detail).toContain("storedAssignment.assignment_role === 'bank'");
    expect(detail).toContain('assignment,');
  });

  it('lets the owner resume or replace a persisted authorization safely', () => {
    const detail = redemptionLifecycle.slice(
      redemptionLifecycle.indexOf("if (action === 'detail')"),
      redemptionLifecycle.indexOf("if (action === 'resume_action_intent')"),
    );
    expect(detail).toContain('row.authorization_expires_at');
    expect(detail).not.toContain('Date.parse(row.authorization_expires_at) > Date.now()');
    expect(redemptionLifecycle).toContain(
      "['proof_approved', 'owner_authorized'].includes(row.status)",
    );
    expect(redemptionLifecycle).toContain('expectedState: row.status');
    const resend = redemptionLifecycle.slice(
      redemptionLifecycle.indexOf("if (action === 'resend_owner_code')"),
      redemptionLifecycle.indexOf(
        "if (['propose_recovery', 'approve_recovery', 'execute_recovery'].includes(action))",
      ),
    );
    expect(resend).toContain("['proof_approved', 'owner_authorized'].includes(row.status)");
  });
});
