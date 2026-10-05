import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { json, preflight } from '../_shared/cors.ts';
import { requireProtocolDeployment } from '../_shared/deployment.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { MissingCapabilityError, operationalMembership } from '../_shared/operations.ts';
import {
  activeMatrix,
  canonicalMatrix,
  matrixDocument,
  parseMatrixDocument,
} from '../_shared/valuationMatrixRegistry.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const user = await requireUser(request);
    const admin = adminClient();
    const deployment = await requireProtocolDeployment(admin, request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? 'current');

    if (action === 'current') {
      await operationalMembership(admin, user.id, 'gemlab.read');
      const current = await activeMatrix(admin, deployment.id);
      return json({
        matrix: {
          id: current.id,
          version: current.matrix.version,
          state: current.state,
          hash: current.hash,
          document: current.document,
        },
      });
    }

    if (action === 'list') {
      await operationalMembership(admin, user.id, 'matrix.propose');
      const { data, error } = await admin
        .from('valuation_matrix_versions')
        .select('id,version,state,matrix_hash,created_at,proposed_at,activated_at,supersedes_id')
        .eq('deployment_id', deployment.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return json({ matrices: data ?? [] });
    }

    if (action === 'create_draft') {
      const membership = await operationalMembership(admin, user.id, 'matrix.propose');
      const matrix = parseMatrixDocument(body.document);
      const requestedVersion = String(body.version ?? '').trim();
      if (!requestedVersion || requestedVersion !== matrix.version) {
        return json({ error: 'Matrix version must match document.version' }, 400);
      }
      const { canonical, hash } = canonicalMatrix(matrix);
      const { data, error } = await admin
        .from('valuation_matrix_versions')
        .insert({
          deployment_id: deployment.id,
          version: matrix.version,
          state: 'draft',
          matrix_document: matrixDocument(matrix),
          canonical_document: canonical,
          matrix_hash: hash,
          created_by: user.id,
        })
        .select('id,version,state,matrix_hash')
        .single();
      if (error) throw error;
      await audit(user.id, 'matrix.draft_created', 'valuation_matrix', data.id, {
        organizationId: membership.organizationId,
        version: matrix.version,
        hash,
      });
      return json({ matrix: data }, 201);
    }

    const matrixId = String(body.matrixId ?? '');
    if (!UUID.test(matrixId)) return json({ error: 'Matrix ID must be a UUID' }, 400);

    if (action === 'propose') {
      const membership = await operationalMembership(admin, user.id, 'matrix.propose');
      const { data, error } = await admin
        .from('valuation_matrix_versions')
        .update({ state: 'proposed', proposed_at: new Date().toISOString() })
        .eq('deployment_id', deployment.id)
        .eq('id', matrixId)
        .eq('state', 'draft')
        .select('id,version,state,matrix_hash')
        .maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: 'Only a draft matrix can be proposed' }, 409);
      await audit(user.id, 'matrix.proposed', 'valuation_matrix', matrixId, {
        organizationId: membership.organizationId,
        version: data.version,
      });
      return json({ matrix: data });
    }

    if (action === 'activate') {
      const membership = await operationalMembership(admin, user.id, 'matrix.activate');
      const expected = String(body.expectedActiveVersion ?? '').trim();
      const current = await activeMatrix(admin, deployment.id);
      if (current.matrix.version !== expected) {
        return json({ error: 'Active matrix changed; reload before activating' }, 409);
      }
      const { data: proposed, error: proposalError } = await admin
        .from('valuation_matrix_versions')
        .select('id,version,state,matrix_document,canonical_document,matrix_hash')
        .eq('deployment_id', deployment.id)
        .eq('id', matrixId)
        .eq('state', 'proposed')
        .maybeSingle();
      if (proposalError) throw proposalError;
      if (!proposed) return json({ error: 'Only a proposed matrix can be activated' }, 409);
      const parsed = parseMatrixDocument(proposed.matrix_document);
      const checked = canonicalMatrix(parsed);
      if (
        checked.canonical !== proposed.canonical_document ||
        checked.hash !== proposed.matrix_hash
      ) {
        throw new Error('Proposed matrix failed its integrity check');
      }

      // History rows are immutable, so activation is an insert-only decision:
      // an active row is not rewritten. The previous built-in/current version is
      // named in supersedes_id when it has a database identity.
      const { data, error } = await admin.rpc('activate_valuation_matrix', {
        p_deployment_id: deployment.id,
        p_matrix_id: matrixId,
        p_expected_active_version: expected,
        p_approved_by: user.id,
      });
      if (error) throw error;
      if (!data) throw new Error('Matrix activation did not return a result');
      await audit(user.id, 'matrix.activated', 'valuation_matrix', matrixId, {
        organizationId: membership.organizationId,
        previousVersion: current.matrix.version,
        version: data.version,
        hash: data.matrix_hash,
      });
      return json({ matrix: data });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    if (error instanceof MissingCapabilityError) return json({ error: 'Not found' }, 404);
    const message = safeErrorMessage(error, 'Matrix operation failed');
    return json({ error: message }, /authorization|session/i.test(message) ? 401 : 400);
  }
});
