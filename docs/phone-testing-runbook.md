# Phone testing runbook

Real-device checks for the parts automation cannot reach: handing a transaction
to the MetaMask app and coming back. Everything up to that handoff is covered by
the automated end-to-end suite; this runbook is about the handoff itself.

Record every run in `phone-testing-results.csv` (one row per case per device).

## 1. Before a pass

**Devices** (minimum matrix — run every case on each row):

| ID | Phone | Browser | Wallet path |
|---|---|---|---|
| IOS-SAF | iPhone, current iOS | Safari | MetaMask app (deep link from the site) |
| IOS-MM | iPhone | MetaMask in-app browser | built-in |
| AND-CHR | Android, current | Chrome | MetaMask app (deep link) |
| AND-WC | Android | Chrome | WalletConnect wallet (Rainbow or Trust) |

Run IOS-CHR (Chrome on iPhone) once per release as a spot check; it uses the
same engine as Safari but a different app-switch path.

**Accounts.** Two Digital Carat accounts with verified wallets, on two phones or
two browsers:

- **A (sender/seller)** — holds at least two tokens with a positive reserve.
- **B (recipient/buyer)** — a different email and wallet.

Each wallet needs Sepolia ETH for gas and mUSDC (use the faucet button in the
app header).

**Diagnostics.** On each phone, open `https://digitalcarat.io/?debug=1` once. A
small **Diagnostics** button stays at the bottom-left from then on, across the
MetaMask round trip. Turn it off afterwards with `?debug=0`.

**Screen recording** on for the whole case (iOS: Control Centre → Screen
Recording; Android: Quick Settings → Screen record).

## 2. For every failure

1. Stop. Don't retry yet — a retry can hide what happened.
2. Tap **Diagnostics → Copy report** and paste it into the results row (or a
   note linked from it).
3. Note the transaction hash if one is shown.
4. Save the screen recording with the case ID in its name.

**Severity**

- **S1** — money or a token in the wrong place, a duplicate charge, or a stuck
  item with no way forward.
- **S2** — the flow fails but can be recovered (retry, reload, Finish button).
- **S3** — confusing wording, layout, slow but working.

## 3. Interruption variants

Most bugs so far appeared only when the phone did something between the tap and
the return. Every case marked **(+V)** below is run once normally, then once with
each of these:

| Code | Do this while the wallet prompt is open |
|---|---|
| V1 | Approve in the wallet, then switch back to the browser yourself (not via the wallet's "return" link) |
| V2 | Lock the phone for 30 s before approving; unlock, approve, return |
| V3 | Reject in the wallet |
| V4 | After approving, swipe the browser away from the app switcher and reopen the site |
| V5 | Turn on Low Data Mode / a weak network (or Airplane mode briefly right after approving) |

**Expected for every variant:** the app ends in a truthful state — confirmed,
still pending with a hash, or cleanly cancelled — and never offers a second
payment for a transaction that may already have been sent.

## 4. Cases

Each case lists the expected result. "Shows up" means within about 30 s,
without a manual reload.

### Connect and sign-in

- **C1 First connect.** Clear site data. Sign in by email, connect the wallet,
  sign the verification message. → Wallet shows connected; the profile shows the
  verified address; the header shows the right network.
- **C2 Return to a suspended tab (+V1, V2).** Connect, background the browser
  for 5 minutes, return. → Still connected, no new wallet prompt.
- **C3 Wrong network.** Switch MetaMask to Ethereum mainnet, start any
  transaction. → App asks to switch to Sepolia; after switching, the
  transaction continues.

### Buying and auctions

- **B1 Buy now with reserve top-up (+V).** → Token appears in A's Portfolio;
  the purchase appears in history; no second payment offered.
- **B2 Auction bid.** Bid on a live auction. → The bid shows on the auction and
  in history; a notification arrives.
- **B3 Secondary listing and purchase.** A lists a token; B buys it. → The token
  moves to B; both histories show it.
- **B4 Offer and acceptance.** B makes an offer on A's token; A accepts. → The
  token moves; the offer disappears from open offers.

### Swaps

- **SW1 Propose (+V).** A proposes a swap of their token for B's token. → The
  offer appears under Open swap requests for both.
- **SW2 Accept (+V).** B accepts. → Tokens swap owners; both histories show it.
- **SW3 Low reserve.** Propose a swap using a token with a small but positive
  reserve (well under 10%). → Allowed.
- **SW4 Self-swap.** In "You receive", A's own tokens must not be offered.
- **SW5 Cancel.** A cancels an open offer. → A's token returns; the offer
  disappears.

### Transfers

- **T1 Direct transfer (+V).** A sends a token to B's address. → Completes
  without hanging on "Preparing"; the token appears in B's Portfolio.

### Gift cards

- **G1 Make a gift card (+V).** A makes a card for B's email and completes the
  escrow transfer. → Issued screen appears. The sender-copy line says the copy
  **was** emailed (or says why not, with **Email my copy**). A receives the
  printable copy.
- **G2 Email the recipient.** On the issued screen tap **Email the recipient**.
  → B receives the email with a working claim link and code.
- **G3 Claim.** B opens the link, signs in, claims. → The token appears in B's
  Portfolio; A's card shows Claimed.
- **G4 Interrupted setup.** Start a card, approve the escrow transfer in
  MetaMask, then close the browser tab before returning (V4). Reopen
  Portfolio → Gift cards. → The card shows **Finish gift card**; finishing it
  issues the card **without** a second wallet transfer.
- **G5 Abandoned setup.** Start a card, stop at the transfer step, close the tab.
  Start a new card for the same token. → The new card works (no "already has a
  gift" error).
- **G6 Cancel.** Cancel an active card from Portfolio. → The token returns to A.

### Redemption

- **R1 Request (+V).** A requests redemption. → The token shows as locked; the
  verify portal lists the request.
- **R2 Cancel by owner.** A cancels. → The token is unlocked.
- **R3 Cancel by custodian.** The custodian cancels from the verify portal. →
  Succeeds.
- **R4 Hand-over.** The custodian confirms hand-over. → The token is burned and
  A's Portfolio shows a reserve credit to claim.
- **R5 Claim reserve credit.** A claims, once to their own wallet and once to a
  different address. → Funds arrive at the chosen address.

### History and notifications

- **H1** After the cases above, A's and B's Portfolio histories list bids,
  purchases, swaps, gift cards and redemptions in date order, with none missing.
- **H2** Notifications show the time for events under 24 h old (14:13) and the
  date after that (24/12/2026).

## 5. Pass criteria

A release passes phone testing when every case passes on every device row with
no S1 or S2 open. S3 items are logged and scheduled, not blocking.
