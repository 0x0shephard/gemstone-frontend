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
