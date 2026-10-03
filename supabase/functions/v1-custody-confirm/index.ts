import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import {
  canConfirmCustody,
  NotACustodianError,
  NotAVerifierError,
  requireVerifier,
} from '../_shared/verifier.ts';
import { requireProtocolDeployment } from '../_shared/deployment.ts';
import { dgeNftAbi, dgeNftAddress, gemRegistryAbi, operatorChain } from '../_shared/chain.ts';
import { CustodyTermInputError, parseCustodyTermInput } from '../_shared/custodyTerm.ts';
import { getAddress, isAddress, zeroAddress } from 'npm:viem@2';

/**
 * Records that a stone physically arrived, releasing it to the grading queue.
 *
 * Nothing here touches the chain. `GemRegistry.confirmCustody` is a mechanical
 * transition that has to stay inside the atomic activation sequence, because
 * `verifyGem` requires `CustodyConfirmed` and `registerGem` cannot run before
 * grading. This is the physical event that call attests to, and it must happen
 * first: a lab grading from the seller's photographs would defeat the whole
 * point of separating claimed attributes from graded ones.
 */

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const user = await requireUser(request);
    const admin = adminClient();
    const deployment = await requireProtocolDeployment(admin, request);
    const membership = await requireVerifier(admin, user.id);
    if (!canConfirmCustody(membership)) throw new NotACustodianError();

    const body = (await request.json()) as Record<string, unknown>;
    if (body.action === 'record_term') {
      const term = parseCustodyTermInput(body);
      const chain = operatorChain();
      const gem = (await chain.publicClient.readContract({
        address: chain.addresses.registry,
        abi: gemRegistryAbi,
        functionName: 'getGem',
        args: [BigInt(term.gemId)],
      })) as { seller: string; custodian: string; tokenId: bigint };
      if (gem.seller.toLowerCase() === zeroAddress || gem.tokenId <= 0n) {
        return json({ error: 'That gemstone is not a tokenised gem in this deployment' }, 404);
      }
      try {
        await chain.publicClient.readContract({
          address: dgeNftAddress(),
          abi: dgeNftAbi,
          functionName: 'ownerOf',
          args: [gem.tokenId],
        });
      } catch {
        return json({ error: 'That gemstone no longer has a live token' }, 409);
      }

      // An admin organisation represents the platform operator's vault. A
      // third-party custodian must instead prove the primary wallet recorded
      // on the gem. Merely belonging to some custody organisation must never
      // grant authority to set terms for every stone in the protocol.
      let custodyMatches =
        membership.kind === 'admin' &&
        getAddress(gem.custodian) === getAddress(chain.account.address);
      if (!custodyMatches) {
        const { data: walletLink, error: walletError } = await admin
          .from('wallet_links')
          .select('wallet_address')
          .eq('profile_id', user.id)
          .eq('is_primary', true)
          .not('verified_at', 'is', null)
          .maybeSingle();
        if (walletError) throw walletError;
        const walletAddress = walletLink?.wallet_address;
        custodyMatches =
          typeof walletAddress === 'string' &&
          isAddress(walletAddress) &&
          getAddress(walletAddress) === getAddress(gem.custodian);
      }
      if (!custodyMatches) {
        return json(
          { error: 'Only this gemstone’s verified custodian may record its escrow term' },
          403,
        );
      }

      const [submissionLookup, attestationLookup] = await Promise.all([
        admin
          .from('seller_submissions')
          .select('reserve_escrow_ends_at')
          .eq('deployment_id', deployment.id)
          .eq('onchain_gem_id', term.gemId)
          .not('reserve_escrow_ends_at', 'is', null)
          .limit(1)
          .maybeSingle(),
        admin
          .from('gem_custody_terms')
          .select('reserve_escrow_ends_at')
          .eq('deployment_id', deployment.id)
          .eq('gem_id', term.gemId)
          .maybeSingle(),
      ]);
      if (submissionLookup.error) throw submissionLookup.error;
      if (attestationLookup.error) throw attestationLookup.error;
      if (submissionLookup.data?.reserve_escrow_ends_at || attestationLookup.data) {
        return json(
          {
            error:
              'A reserve escrow end date is already recorded for this gemstone and cannot be overwritten',
          },
          409,
        );
      }

      const { error: insertError } = await admin.from('gem_custody_terms').insert({
        deployment_id: deployment.id,
        gem_id: term.gemId,
        reserve_escrow_ends_at: term.reserveEscrowEndsAt,
        recorded_by: membership.profileId,
        organization_id: membership.organizationId,
        attestation_note: term.attestationNote,
      });
      if (insertError?.code === '23505') {
        return json(
          {
            error:
              'A reserve escrow end date is already recorded for this gemstone and cannot be overwritten',
          },
          409,
        );
      }
      if (insertError) throw insertError;

      await audit(membership.profileId, 'custody.term_recorded', 'gem', term.gemId, {
        deploymentId: deployment.id,
        organization: membership.organizationName,
        reserveEscrowEndsAt: term.reserveEscrowEndsAt,
        tokenId: gem.tokenId.toString(),
      });
      return json({
        gemId: term.gemId,
        tokenId: gem.tokenId.toString(),
        reserveEscrowEndsAt: term.reserveEscrowEndsAt,
      });
    }

    const submissionId = String(body.submissionId ?? '');
    if (!uuidPattern.test(submissionId)) {
      return json({ error: 'Submission ID must be a UUID' }, 400);
    }

    const notes = typeof body.conditionNotes === 'string' ? body.conditionNotes.trim() : '';
    if (notes.length > 2_000) {
      return json({ error: 'Condition notes must be 2000 characters or fewer' }, 400);
    }
    if (typeof body.matchesDeclared !== 'boolean') {
      return json({ error: 'Record whether the stone matches the declared attributes' }, 400);
    }
    /*
     * A divergence has to be described. "Does not match" with no explanation
     * tells the grader something is wrong but not what, which is worse than
     * silence because it invites them to guess.
     */
    if (!body.matchesDeclared && notes.length < 10) {
      return json(
        { error: 'Describe the divergence in the condition notes before confirming' },
        400,
      );
    }

    /*
     * The escrow term is recorded here because here is where it is known: it
     * comes from the arrangement this custodian entered into for this stone.
     * Nothing on chain carries it — `ReserveManager` has no timestamps — and a
     * gift card issued over the token may not outlive it, so a missing date
     * later becomes a refusal to issue rather than a card with an invented
     * expiry.
     */
    const escrowEndsAt = new Date(String(body.reserveEscrowEndsAt ?? ''));
    if (Number.isNaN(escrowEndsAt.getTime())) {
      return json({ error: 'Record the date this stone’s reserve escrow ends' }, 400);
    }
    if (escrowEndsAt.getTime() <= Date.now()) {
      return json({ error: 'The reserve escrow end date must be in the future' }, 400);
    }

    const { data: confirmed, error } = await admin
      .from('seller_submissions')
      .update({
        status: 'awaiting_grading',
        custody_received_at: new Date().toISOString(),
        custody_received_by: membership.profileId,
        custody_organization: membership.organizationId,
        custody_condition_notes: notes || null,
        custody_matches_declared: body.matchesDeclared,
        reserve_escrow_ends_at: escrowEndsAt.toISOString(),
      })
      .eq('id', submissionId)
      .eq('deployment_id', deployment.id)
      // Guarded so a second confirmation cannot overwrite the first intake
      // record, and so a stone already graded cannot be walked backwards.
      .eq('status', 'awaiting_custody')
      .is('custody_received_at', null)
      .select('id,status')
      .maybeSingle();
    if (error) throw error;
    if (!confirmed) {
      return json({ error: 'This submission is not awaiting custody intake' }, 409);
    }

    await audit(membership.profileId, 'custody.confirmed', 'seller_submission', submissionId, {
      organization: membership.organizationName,
      role: membership.role,
      matchesDeclared: body.matchesDeclared,
      conditionNotes: notes || null,
      reserveEscrowEndsAt: escrowEndsAt.toISOString(),
    });

    return json({
      submissionId,
      status: 'awaiting_grading',
      reserveEscrowEndsAt: escrowEndsAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof NotAVerifierError) return json({ error: 'Not found' }, 404);
    if (error instanceof NotACustodianError) return json({ error: error.message }, 403);
    if (error instanceof CustodyTermInputError) return json({ error: error.message }, 400);
    const message = safeErrorMessage(error, 'Custody confirmation failed');
    const authorizationError = message === 'Missing authorization' || message === 'Invalid session';
    return json({ error: message }, authorizationError ? 401 : 400);
  }
});
