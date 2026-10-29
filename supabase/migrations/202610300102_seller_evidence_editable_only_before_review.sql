-- Sellers may add or remove evidence only while the submission is still theirs
-- to edit.
--
-- The previous policies (202610020003) checked ownership, deployment scope and
-- that no commitment or gem existed, but not the submission's status. A seller
-- could therefore delete a certificate or photograph after the custodian, the
-- lab or the bank had reviewed it, upload a different one, and have activation
-- publish and commit the substitute. The same gap existed one level down: the
-- storage delete policy let the seller remove the object behind a reviewed
-- evidence row and upload different bytes under the same path.
--
-- Editable means `submitted` (before `verify` queues it for custody) or
-- `changes_requested` (handed back to the seller), with no appraisal recorded.
-- Everything from `awaiting_custody` on is under review and frozen.
-- Redemption documents (no submission) are unaffected.

drop policy if exists evidence_insert_own on public.evidence_files;
create policy evidence_insert_own
on public.evidence_files for insert
to authenticated
with check (
  auth.uid() = owner_id
  and deployment_id = public.requested_protocol_deployment_id()
  and public.requested_protocol_deployment_is_active()
  and (
    (
      submission_id is not null
      and category in ('certificate', 'gem_media')
      and exists (
        select 1
        from public.seller_submissions
        where id = submission_id
          and deployment_id = public.requested_protocol_deployment_id()
          and seller_id = auth.uid()
          and status in ('submitted', 'changes_requested')
          and current_appraisal_id is null
          and certificate_hash is null
          and onchain_gem_id is null
      )
    )
    or (submission_id is null and category = 'redemption_document')
  )
);

drop policy if exists evidence_delete_own on public.evidence_files;
create policy evidence_delete_own
on public.evidence_files for delete
to authenticated
using (
  auth.uid() = owner_id
  and deployment_id = public.requested_protocol_deployment_id()
  and public.requested_protocol_deployment_is_active()
  and (
    submission_id is null
    or exists (
      select 1
      from public.seller_submissions
      where id = submission_id
        and deployment_id = public.requested_protocol_deployment_id()
        and seller_id = auth.uid()
        and status in ('submitted', 'changes_requested')
        and current_appraisal_id is null
        and certificate_hash is null
        and onchain_gem_id is null
    )
  )
);

-- The bytes behind a reviewed evidence row are frozen too. Objects that no
-- evidence row references (an upload whose row insert failed) stay deletable.
drop policy if exists private_delete_own_prefix on storage.objects;
create policy private_delete_own_prefix
on storage.objects for delete
to authenticated
using (
  bucket_id in ('certificates', 'gem-media', 'redemption-documents')
  and (storage.foldername(name))[1] = auth.uid()::text
  and not exists (
    select 1
    from public.evidence_files
    join public.seller_submissions
      on public.seller_submissions.id = public.evidence_files.submission_id
    where public.evidence_files.bucket = bucket_id
      and public.evidence_files.object_path = name
      and public.evidence_files.owner_id = auth.uid()
      and (
        public.seller_submissions.status not in ('submitted', 'changes_requested')
        or public.seller_submissions.current_appraisal_id is not null
        or public.seller_submissions.certificate_hash is not null
        or public.seller_submissions.onchain_gem_id is not null
      )
  )
);
