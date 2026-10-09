import { custodyDatesProblem } from '../_shared/custodyDates.ts';
import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { json, preflight } from '../_shared/cors.ts';
import { requireProtocolDeployment } from '../_shared/deployment.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import {
  MissingCapabilityError,
  isGlobalOperationalAdmin,
  operationalMembership,
} from '../_shared/operations.ts';
import { loadProjection, workflowTimeline } from '../_shared/workflowEvents.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function instant(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO date`);
  }
  return new Date(value).toISOString();
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const user = await requireUser(request);
    const admin = adminClient();
    const deployment = await requireProtocolDeployment(admin, request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? 'seller_queue');
    const membership = await operationalMembership(
      admin,
      user.id,
      'bank.receive',
      typeof body.organizationId === 'string' ? body.organizationId : undefined,
    );

    if (action === 'seller_queue') {
      const { data, error } = await admin
        .from('seller_submissions')
        .select(
          'id,gem_name,status,created_at,bank_received_at,bank_location,current_appraisal_id,' +
            'gem_appraisals!seller_submissions_current_appraisal_id_fkey(id,approved_valuation_usd,matrix_version,matrix_hash,created_at)',
        )
        .eq('deployment_id', deployment.id)
        .not('current_appraisal_id', 'is', null)
        .is('bank_received_at', null)
        .neq('status', 'withdrawn')
        .order('created_at')
        .limit(100);
      if (error) throw error;
      return json({
        queue: await Promise.all(
          (data ?? []).map(async (row) => {
            const appraisal = row.gem_appraisals as unknown as {
              id: string;
              approved_valuation_usd: string;
              matrix_version: string;
              matrix_hash: string;
              created_at: string;
            } | null;
            const projection = await loadProjection(admin, deployment.id, 'seller', row.id);
            return {
              submissionId: row.id,
              stoneName: row.gem_name,
              state: projection?.current_state ?? row.status,
              version: projection ? Number(projection.version) : 0,
              submittedAt: row.created_at,
              appraisal: appraisal
                ? {
                    appraisalId: appraisal.id,
                    approvedValuationUsd: String(appraisal.approved_valuation_usd),
                    matrixVersion: appraisal.matrix_version,
                    matrixHash: appraisal.matrix_hash,
                    createdAt: appraisal.created_at,
                  }
                : null,
            };
          }),
        ),
      });
    }

    if (action === 'custody_terms') {
      // The stones this vault custodian holds, with their current agreement
      // and amendment history. An admin sees every stone.
      const global = isGlobalOperationalAdmin(membership);
      let receipts = admin
        .from('seller_submissions')
        .select('onchain_gem_id::text,gem_name,bank_organization_id')
        .eq('deployment_id', deployment.id)
        .not('onchain_gem_id', 'is', null)
        .not('reserve_escrow_ends_at', 'is', null);
      if (!global) receipts = receipts.eq('bank_organization_id', membership.organizationId);
      let attested = admin
        .from('gem_custody_terms')
        .select('gem_id::text,organization_id')
        .eq('deployment_id', deployment.id);
      if (!global) attested = attested.eq('organization_id', membership.organizationId);
      const [receiptRows, attestedRows] = await Promise.all([receipts, attested]);
      if (receiptRows.error) throw receiptRows.error;
      if (attestedRows.error) throw attestedRows.error;
      const names = new Map<string, string>();
      for (const row of (receiptRows.data ?? []) as Array<Record<string, string>>) {
        names.set(row.onchain_gem_id, row.gem_name);
      }
      for (const row of (attestedRows.data ?? []) as Array<Record<string, string>>) {
        if (!names.has(row.gem_id)) names.set(row.gem_id, `Gemstone #${row.gem_id}`);
      }
      const terms = await Promise.all(
        [...names.entries()].map(async ([gemId, stoneName]) => {
          const [effective, amendments] = await Promise.all([
            admin.rpc('effective_gem_custody', {
              p_deployment_id: deployment.id,
              p_gem_id: gemId,
            }),
            admin
              .from('gem_custody_amendments')
              .select('previous_ends_at,new_ends_at,reference,amended_at')
              .eq('deployment_id', deployment.id)
              .eq('gem_id', gemId)
              .order('amended_at', { ascending: false }),
          ]);
          if (effective.error) throw effective.error;
          if (amendments.error) throw amendments.error;
          const current = (effective.data ?? [])[0] as
            { ends_at: string; source: string } | undefined;
          return {
            gemId,
            stoneName,
            endsAt: current?.ends_at ?? null,
            source: current?.source ?? null,
            amendments: (amendments.data ?? []).map((row) => ({
              previousEndsAt: row.previous_ends_at,
              newEndsAt: row.new_ends_at,
              reference: row.reference,
              amendedAt: row.amended_at,
            })),
          };
        }),
      );
      terms.sort((left, right) => Number(BigInt(left.gemId) - BigInt(right.gemId)));
      return json({ terms });
    }

    if (action === 'amend_custody_term') {
      // A signed renewal extends the agreement; the original record stays.
      const gemId = String(body.gemId ?? '').trim();
      if (!/^\d+$/.test(gemId) || BigInt(gemId) <= 0n) {
        return json({ error: 'A positive numeric gemstone id is required' }, 400);
      }
      const reference = String(body.reference ?? '').trim();
      if (reference.length < 10 || reference.length > 2_000) {
        return json({ error: 'Reference the signed amendment in 10 to 2000 characters' }, 400);
      }
      if (body.attestAccurate !== true) {
        return json({ error: 'Confirm the new date comes from a signed amendment' }, 400);
      }
      const expectedEndsAt = instant(body.expectedEndsAt, 'expectedEndsAt');
      const newEndsAt = instant(body.newEndsAt, 'newEndsAt');
      const { data: current, error: currentError } = await admin.rpc('effective_gem_custody', {
        p_deployment_id: deployment.id,
        p_gem_id: gemId,
      });
      if (currentError) throw currentError;
      const term = (current ?? [])[0] as { organization_id: string | null } | undefined;
      if (!term) return json({ error: 'This gemstone has no recorded custody agreement' }, 404);
      if (
        !isGlobalOperationalAdmin(membership) &&
        term.organization_id !== membership.organizationId
      ) {
        return json(
          { error: 'Only the vault custodian holding this stone may amend its agreement' },
          403,
        );
      }
      const { data: amendment, error: amendError } = await admin.rpc('amend_gem_custody', {
        p_deployment_id: deployment.id,
        p_gem_id: gemId,
        p_expected_ends_at: expectedEndsAt,
        p_new_ends_at: newEndsAt,
        p_reference: reference,
        p_amended_by: user.id,
        p_organization_id: membership.organizationId,
      });
      if (amendError) {
        const status = amendError.code === 'DC409' ? 409 : amendError.code === 'DC404' ? 404 : 400;
        return json({ error: amendError.message }, status);
      }
      await audit(user.id, 'custody.agreement_amended', 'gem', gemId, {
        previousEndsAt: expectedEndsAt,
        newEndsAt,
        organizationId: membership.organizationId,
      });
      return json({ amendment });
    }

    if (action !== 'record_receipt') return json({ error: 'Unknown action' }, 400);
    const submissionId = String(body.submissionId ?? '');
    const idempotencyKey = String(body.idempotencyKey ?? '');
    const expectedVersion = Number(body.expectedVersion ?? 0);
    const location = String(body.location ?? '').trim();
    const notes = String(body.conditionNotes ?? '').trim();
    if (!UUID.test(submissionId) || !UUID.test(idempotencyKey)) {
      return json({ error: 'Valid submissionId and idempotencyKey are required' }, 400);
    }
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      return json({ error: 'expectedVersion must be a non-negative integer' }, 400);
    }
    if (location.length < 3 || location.length > 300 || notes.length < 3 || notes.length > 2_000) {
      return json({ error: 'Location and condition notes are required' }, 400);
    }
    const receivedAt = instant(body.receivedAt, 'receivedAt');
    const custodyStartedAt = instant(body.custodyStartedAt, 'custodyStartedAt');
    const reserveEscrowEndsAt = instant(body.reserveEscrowEndsAt, 'reserveEscrowEndsAt');
    // Same rule as record_bank_receipt, but naming the date that breaks it.
    const datesProblem = custodyDatesProblem({
      receivedAt: new Date(receivedAt),
      custodyStartedAt: new Date(custodyStartedAt),
      agreementEndsAt: new Date(reserveEscrowEndsAt),
    });
    if (datesProblem) return json({ error: datesProblem }, 400);

    const { data: submission, error: lookupError } = await admin
      .from('seller_submissions')
      .select('id,status,current_appraisal_id,bank_received_at')
      .eq('deployment_id', deployment.id)
      .eq('id', submissionId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!submission) return json({ error: 'Submission not found' }, 404);
    if (submission.status === 'withdrawn') {
      return json({ error: 'The seller withdrew this submission' }, 409);
    }
    const projection = await loadProjection(admin, deployment.id, 'seller', submissionId);
    const currentVersion = projection ? Number(projection.version) : 0;
    const { data: priorEvent, error: priorEventError } = await admin
      .from('workflow_events')
      .select('id')
      .eq('deployment_id', deployment.id)
      .eq('workflow_kind', 'seller')
      .eq('workflow_id', submissionId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (priorEventError) throw priorEventError;
    if (!priorEvent && currentVersion !== expectedVersion) {
      return json({ error: 'Workflow changed; reload before acting' }, 409);
    }

    const { data: recorded, error } = await admin.rpc('record_bank_receipt', {
      p_deployment_id: deployment.id,
      p_submission_id: submissionId,
      p_organization_id: membership.organizationId,
      p_received_by: user.id,
      p_received_at: receivedAt,
      p_location: location,
      p_custody_started_at: custodyStartedAt,
      p_reserve_escrow_ends_at: reserveEscrowEndsAt,
      p_condition_notes: notes,
      p_matches_declared: body.matchesDeclared === true,
      p_expected_version: expectedVersion,
      p_expected_state: projection?.current_state ?? submission.status,
      p_idempotency_key: idempotencyKey,
    });
    if (error) throw error;
    if (!priorEvent) {
      await audit(user.id, 'bank.receipt_recorded', 'seller_submission', submissionId, {
        organizationId: membership.organizationId,
        receivedAt: recorded.bank_received_at,
        location: recorded.bank_location,
        custodyStartedAt: recorded.bank_custody_started_at,
        reserveEscrowEndsAt: recorded.reserve_escrow_ends_at,
        matchesDeclared: recorded.custody_matches_declared,
      });
    }
    const resultingProjection = await loadProjection(admin, deployment.id, 'seller', submissionId);
    return json({
      workflow: {
        workflowId: submissionId,
        submissionId,
        state: 'bank_received',
        version: resultingProjection ? Number(resultingProjection.version) : expectedVersion + 1,
        legacyBaseline: resultingProjection?.legacy_baseline ?? expectedVersion === 0,
        updatedAt: recorded.updated_at,
        stoneName: recorded.gem_name,
        bankLocation: recorded.bank_location,
        bankReceivedAt: recorded.bank_received_at,
        events: await workflowTimeline(admin, deployment.id, 'seller', submissionId),
        nextActions: ['start_seller_activation'],
      },
    });
  } catch (error) {
    if (error instanceof MissingCapabilityError) return json({ error: 'Not found' }, 404);
    const message = safeErrorMessage(error, 'Bank workflow failed');
    return json({ error: message }, /authorization|session/i.test(message) ? 401 : 400);
  }
});
