import { canonicalize } from './canonicalJson.ts';

export function sameAppraisalIntent(
  persisted: {
    organization_id: string;
    appraised_by: string;
    primary_image_evidence_id: string | null;
    graded_inputs: unknown;
  },
  requested: {
    organizationId: string;
    appraisedBy: string;
    primaryImageId: string;
    gradedInputs: unknown;
  },
): boolean {
  return (
    persisted.organization_id === requested.organizationId &&
    persisted.appraised_by === requested.appraisedBy &&
    persisted.primary_image_evidence_id === requested.primaryImageId &&
    canonicalize(persisted.graded_inputs) === canonicalize(requested.gradedInputs)
  );
}
