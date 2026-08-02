-- Public NFT metadata publication record.
--
-- `GemRegistry.registerGem` writes `metadataURI` once and neither it nor
-- `DGENFT` exposes a setter, so a published document can never be corrected or
-- repointed. Retaining the exact bytes alongside the CID is what makes a lapsed
-- pin recoverable: re-pinning identical bytes reproduces the same CID, and the
-- URI already on-chain resolves again.

alter table public.seller_submissions
  add column if not exists metadata_cid text,
  add column if not exists metadata_document text,
  add column if not exists metadata_published_at timestamptz;

comment on column public.seller_submissions.metadata_cid is
  'IPFS CID of the published public metadata. Null while the submission still carries an inline data: URI.';
comment on column public.seller_submissions.metadata_document is
  'Exact canonical JSON bytes published for metadata_cid. Re-pinning these bytes reproduces the same CID.';
comment on column public.seller_submissions.metadata_published_at is
  'When the document was pinned and verified against independent gateways.';

-- A CID must never be recorded without the bytes that produced it, or the
-- recovery path this table exists to provide does not work.
alter table public.seller_submissions
  drop constraint if exists seller_submissions_metadata_publication_complete;
alter table public.seller_submissions
  add constraint seller_submissions_metadata_publication_complete
  check (
    (metadata_cid is null and metadata_document is null and metadata_published_at is null)
    or (metadata_cid is not null and metadata_document is not null and metadata_published_at is not null)
  );

create index if not exists seller_submissions_metadata_cid_idx
  on public.seller_submissions (metadata_cid)
  where metadata_cid is not null;
