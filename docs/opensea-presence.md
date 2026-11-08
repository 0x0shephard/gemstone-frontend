# OpenSea presence

Goal: a collection page that reads like an established physical-goods issuer.
[Courtyard](https://opensea.io/collection/courtyard-nft) is the reference.

## What the repo controls

- `public/collection.json` and `public/brand/opensea-*.png`: the collection's
  name, description, logo and banner, read through `contractURI()`.
- `buildPublicMetadata` (`supabase/functions/_shared/metadataDocument.ts`): the
  permanent document for each **new** stone. Generic names gain weight and cut,
  values are cased for display, and `external_url` points at `/opensea`.
- `/opensea`: the page for buyers who found a stone on OpenSea.

Tokens already minted keep their metadata. `tokenURI` has no setter.

## Owner steps

1. After the frontend merges, deploy the functions that build metadata:

   ```bash
   npx supabase functions deploy v1-seller-submit v1-seller-activate v1-verification-grade v1-admin-operations
   ```

2. In the Safe Transaction Builder on Arbitrum One, target DGENFT
   `0x603687aBbc6504Bc6EA8836fA44cFBaE92b42D4E`:
   - `setDefaultRoyalty(0xD420d1bdCFd89eC47437E6Ca97Bf32373a5C94A9, 200)`
   - `setContractURI("https://digitalcarat.io/collection.json")`, unchanged, to
     emit `ContractURIUpdated` so marketplaces re-read the file.

3. Sign in to OpenSea as the collection owner (the Safe), then in Studio set
   creator earnings to 2% with the Safe as recipient, and add the website and X
   links. A page edit there is the fallback if the refresh does not show.

## What OpenSea grants

These are not self-serve, and OpenSea publishes no criteria we could find. Ask
through OpenSea's partner or support contact:

- the verified badge;
- inclusion in the physicals view;
- the item-page **Redeem** tab, handing off to `/redeem`;
- a **Buy on Digital Carat** button.

Bring: contract and Safe addresses, the redemption flow, custody and insurance
evidence, a named grading lab, and live listings.

## Not built yet

- A short turntable video per stone (`animation_url`). It needs video capture at
  intake, and Courtyard's item pages lead with one.
- Enforced royalties (ERC-721C). This changes DGENFT's transfer path and is not
  worth it at the current volume.
