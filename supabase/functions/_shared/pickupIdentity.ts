function identityName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function assertPickupCollector(input: {
  collectedByName: string;
  proxyUsed: boolean;
  ownerProfileName?: string | null;
  ownerIdentityEvidenceOwned?: boolean;
  collectorWallet?: string | null;
  collectorCommitment?: string | null;
  nomination?: {
    state: string;
    proxyName: string;
    proxyWallet: string;
    collectorCommitment: string;
  } | null;
}): void {
  if (!input.proxyUsed) {
    if (
      !input.ownerIdentityEvidenceOwned ||
      !input.ownerProfileName ||
      identityName(input.ownerProfileName) !== identityName(input.collectedByName)
    ) {
      throw new Error('Collector does not match the verified redemption owner');
    }
    return;
  }
  const nomination = input.nomination;
  if (
    !nomination ||
    nomination.state !== 'approved' ||
    !input.collectorCommitment ||
    nomination.collectorCommitment.toLowerCase() !== input.collectorCommitment.toLowerCase() ||
    identityName(nomination.proxyName) !== identityName(input.collectedByName) ||
    nomination.proxyWallet.toLowerCase() !== String(input.collectorWallet ?? '').toLowerCase()
  ) {
    throw new Error('Collector does not match the active owner-authorized proxy nomination');
  }
}
