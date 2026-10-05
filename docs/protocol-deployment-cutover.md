# Protocol deployment cutover

This runbook changes which Sepolia protocol suite the application uses without
deleting the previous suite or any account/workflow records. It is deliberately
two-phase: schema and code can be staged while the legacy deployment remains
active; activation is a separate compare-and-swap transaction.

## Invariants

- `profiles`, `wallet_links`, authentication, KYC, verifier membership, Canva
  connections, push subscriptions, and uploaded objects are account data and are
  never reset by a protocol cutover.
- Every gemstone workflow row carries `deployment_id`. Legacy and fresh token,
  gem, offer and swap identifiers may be equal without colliding.
- Headerless pre-cutover browser bundles are pinned to the legacy deployment for
  reads. Their Edge mutations fail closed after fresh activation. Direct writes
  require the request's deployment to be active.
- Manifest-selected browser builds send `x-protocol-deployment` on Supabase and
  Edge requests. Edge Functions additionally compare all configured contract
  addresses, chain id and deployment block with the active database manifest.
- A frontend must not be published until its no-store pre-signature release
  check is proven against the production deployment manifest.

## Redemption V2 release gate

The operational-lifecycle release and the in-place RedemptionManager V2 upgrade
have an additional, fail-closed gate. Do not apply the migration, deploy the new
functions, publish the UI, or broadcast the upgrade until every production input
below has been recorded and independently checked:

- `A`: a dedicated backend authorizer address and private key held only in the
  Edge secret store. It must not be the protocol operator, proof approver, or a
  recovery approver. Never put the key in a `VITE_` variable, a manifest, a log,
  a database row, or a repository file.
- `P`: the proof-approver wallet. `P` may intentionally also be recovery
  approver `R1`.
- `R1` and `R2`: two different, independently controlled wallets with
  `RECOVERY_APPROVER_ROLE`, each linked to a different verified application
  profile. Two profiles routed through one key, or one profile switching between
  keys, does not satisfy the recovery policy.
- One explicitly authorized test inbox. A production email check must prove two
  separate facts: provider acceptance (`2xx` plus message id/audit row) and final
  delivery (provider delivery event or receipt in that inbox).

Before any public-network broadcast, run:

```sh
scripts/verify-operational-lifecycle-migration.sh
npm run check
(cd ../gemstone && forge test --offline)
```

Then exercise the complete flow on the disposable local stack. The stack uses a
backend-only deterministic authorizer, Admin as `P`/`R1`, Custodian as `R2`, two
distinct authenticated recovery profiles, scoped Gemlab/Bank/Custodian
organizations, and the local mail catcher. Test both pickup and courier paths,
proof rejection/resubmission, pre-fulfillment cancellation, response-loss
reconciliation, owner finalization, and two-approver recovery after the seven-day
clock. Test keys are Anvil-only and must never be copied into hosted secrets.

The production order for Redemption V2 is:

1. Take account, legacy-workflow, and deployment-scoped row-count snapshots.
2. Apply `202610030001_operational_lifecycles.sql`; verify all 13 new tables have
   RLS, browser roles have no table/RPC grants, the exact matrix-v3 seed is
   active, and existing account/workflow counts are unchanged.
3. Deploy the new operations and lifecycle Edge Functions while the new UI is
   still unpublished. Set `REDEMPTION_AUTHORIZER_PRIVATE_KEY` and
   `REDEMPTION_AUTHORIZER_ADDRESS`, then prove the derived address matches `A`.
   Calls requiring V2 must fail closed while the old contract implementation is
   still live.
4. Simulate `UpgradeRedemptionManager` against a current Sepolia fork with the
   exact production inputs. Verify `A` has only `AUTHORIZER_ROLE`, `P` has
   `PROOF_APPROVER_ROLE`, `R1`/`R2` have `RECOVERY_APPROVER_ROLE`, threshold is
   two, delay is at least seven days, and the legacy two-argument request leaves
   the NFT unlocked and reverts.
5. Enter the announced redemption maintenance window. Publish the already-built
   V2-compatible frontend and confirm its immutable asset/manifest, then execute
   the verified proxy upgrade promptly. The new UI is expected to fail closed
   during this short interval.
6. Run authenticated read-only checks, then a controlled test-account pickup
   flow through code delivery and owner burn. Do not use customer records or
   third-party email addresses for this smoke test.

The V2 proxy upgrade is forward-only operationally. It disables unverifiable
legacy two-argument requests and introduces new storage-backed phases. If the
post-upgrade smoke test fails, put redemption into maintenance and fix forward;
do not downgrade the proxy or publish a legacy redemption client. Database and
workflow rows remain preserved for reconciliation.

## Forward cutover

1. Verify the versioned contract manifest checksum, chain id, deployment block,
   block hashes, bytecode at every proxy, roles/wiring and empty fresh state.
2. Record production row counts for account tables and each legacy
   chain-derived table.
3. Apply the deployment-scope and staging migrations. Confirm the legacy row is
   still the only `active` row and the fresh row is `staging`.
4. Deploy the scoped Edge Functions with `PROTOCOL_DEPLOYMENT_ID` and all
   contract secrets still pointing to the legacy suite. Exercise legacy seller,
   gift and redemption reads; verify the old frontend remains compatible.
5. Update the Edge contract secrets and `PROTOCOL_DEPLOYMENT_ID` to the fresh
   manifest. Because its database row is still `staging`, requests fail closed.
6. In one database call, execute:

   ```sql
   select public.activate_protocol_deployment(
     'sepolia-11155111-40fe3f22',
     'sepolia-fresh-11828947'
   );
   ```

7. Verify the active row and Edge configuration match exactly, all fresh-scope
   gemstone tables are empty, legacy counts are unchanged, and account counts
   are unchanged. Verify fresh gift/redemption inspection does not return legacy
   token IDs.
8. Publish the already-built fresh frontend and verify the production no-store
   manifest, browser request header, and pre-signature guard all report
   `sepolia-fresh-11828947`.

## Rollback

Database and Edge roll back before the browser so a fresh bundle fails closed
rather than signing against the wrong suite.

1. Restore every Edge contract secret and `PROTOCOL_DEPLOYMENT_ID` to the legacy
   manifest; deploy the same scoped functions. Calls fail closed while the fresh
   database row remains active.
2. Execute the idempotent database switch:

   ```sql
   select public.activate_protocol_deployment(
     'sepolia-fresh-11828947',
     'sepolia-11155111-40fe3f22'
   );
   ```

   `archived` is a valid target, so the legacy deployment can be reactivated.
   Repeating the call after success is a no-op. Fresh rows remain stored under
   the fresh deployment id.
3. Verify legacy Edge operations and row counts, then publish the immutable
   legacy rollback frontend.

Never publish a frontend-only rollback: its release guard is expected to reject
signatures until the database and Edge deployment have also been rolled back.
