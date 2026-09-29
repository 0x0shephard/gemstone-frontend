# Wallet and transaction workflow repair record

Scope: diagnose and repair wallet connection, transfers, swap proposals and discovery,
portfolio freshness, redemption, gift cards, and lifecycle histories. Requested
sequence: validated causes, GPT-5.6 implementation, then independent Astra review.
This is a local implementation and validation task; deployment remains a distinct step.

## Confirmed causes and acceptance requirements

1. Wallet recovery inspects only the first recoverable connector, has unbounded
   awaits, and caches rejected MetaMask initialization. Recover the approved
   connector without opening new prompts; time out read-only recovery and allow retry.
2. Transaction public reads, simulations, and receipt polling omit the target
   chain even when WalletConnect writes explicitly target it. Pin all protocol
   actions to the configured chain, including recovery and receipt checks.
3. Global gesture gates survive unmount and contend across buttons. Make ownership
   and cancellation explicit, preserve submitted transactions, and prepare RPC
   requests before asking for the final mobile gesture.
4. Chain queries have no foreground polling/return refresh. Projection TTL can
   evict a still-running scan and race IndexedDB writes. Coalesce scans and refresh
   mounted chain views on return and a bounded foreground schedule.
5. Confirmed transfers/redemptions await history refresh, making successful writes
   appear stuck or failed. Return receipts promptly and refresh separately.
6. Portfolio awaits the entire catalog and global workflows. Unrelated failures
   can erase known holdings; failed fee promises remain cached. Bound/coalesce reads,
   retain known data, reset rejected caches, expose independent sync/error status.
7. Swap recipient selection includes the viewer's other tokens and unsuitable
   custody states. Requested tokens must belong to another wallet; offered tokens
   must be directly owned and transferable. Add service guards as well as UI filters.
8. DGENFT transfers currently enforce redemption locks but no zero-reserve guard.
   Direct transfers/gifts must work above zero and fail at zero; enforce on-chain
   as well as in the UI. Preserve storage layout and recovery of escrowed assets.
   Swaps follow the same rule (changed 2026-09-30 from the earlier >10% threshold):
   any positive reserve qualifies, and only an empty reserve blocks a swap.
9. Redemption cancellation UI allows the custodian but contract authorization does
   not; remaining reserve goes to custodian instead of holder. Align cancellation
   with the named parties and return remaining assets to the owner before burn.
   Fulfillment must match the active chain request hash, not merely the latest draft.
10. Gift activation runs only after manual Done, not confirmed escrow. Automatically
    activate after confirmation with a durable retry and resume path.
11. Gift preparation/invocation lacks an overall deadline; confirm uses slow RPC.
    Bound non-wallet calls and reconcile timed-out mutations before retrying.
12. Gift handoff has one destructive-read session slot, so another gem/remount loses
    the claim code. Scope recovery by account/chain/card, retain until completed or
    discarded, and support pending gifts after custody removes them from holdings.
13. Gift claim/cancel resets records on uncertain receipt errors after broadcast.
    Persist hashes and pending states, reconcile without sending duplicate transfers.
14. Burn removes tokenGem mappings; historical offers/swaps then read gem zero and
    break global profiles. Resolve archived identities and parties from events.
15. History uses current ownership, silently truncates to 50, and shows only a gift's
    latest status at its creation date. Preserve lifecycle events, original parties,
    recipient privacy, ordering, and access to older actions.
16. Loading/errors are presented as empty histories/gifts/redemptions. Expose
    syncing and retry states and preserve last known successful results.

## Verification gates

Regression tests must exercise wrong wallet network, suspended/failed recovery,
competing/closed transaction dialogs, successful transaction with failed refresh,
burned-token history, external state refresh, self-swap exclusion, positive/zero
reserve boundaries, escrow cancellation, redemption authorization and payout,
gift confirmation without Done, interrupted recovery, uncertain backend broadcast,
and sender/recipient history isolation. Run frontend checks and affected Solidity
tests. Device wallet app handoff remains a separate real-hardware validation.

## Review and deployment status

Baseline contract suite: 115 tests passed, including four invariants
(`forge test --offline --summary`).

Read-only Sepolia check during diagnosis: PublicNode and Thirdweb both responded
to `eth_blockNumber` in approximately 0.7 and 1.2 seconds. Head 11808424 was
466383 blocks beyond manifest deployment block 11342041. The existing cold scan
therefore requires at least 100 individual log calls at its maximum 50000-block
window. A sampled 50000-block DGENFT log query returned in approximately 0.6 seconds.
This establishes synchronization cost independently of an endpoint outage; it
does not establish device performance or future provider availability.

GPT-5.6 Sol implementation in progress across wallet/data, gift/history/backend,
and contract policy. Astra review pending. No deployment performed by this task.
