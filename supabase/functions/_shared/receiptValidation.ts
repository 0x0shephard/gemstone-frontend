export function assertReceiptEnvelope(input: {
  chainId: number;
  expectedChainId: number;
  status: string;
  to: string | null;
  manager: string;
  from: string;
  expectedSender?: string;
}): void {
  if (input.chainId !== input.expectedChainId) {
    throw new Error('Transaction RPC is on the wrong chain');
  }
  if (
    input.status !== 'success' ||
    !input.to ||
    input.to.toLowerCase() !== input.manager.toLowerCase()
  ) {
    throw new Error('Transaction did not successfully call the redemption manager');
  }
  if (input.expectedSender && input.from.toLowerCase() !== input.expectedSender.toLowerCase()) {
    throw new Error('Transaction sender does not match the verified acting wallet');
  }
}

export function redemptionManagerLogs<T extends { address: string }>(
  logs: T[],
  manager: string,
): T[] {
  return logs.filter((log) => log.address.toLowerCase() === manager.toLowerCase());
}

export function assertRedemptionEventArgs(
  actual: Record<string, unknown>,
  expected: Record<string, string | bigint | boolean>,
): void {
  for (const [label, value] of Object.entries(expected)) {
    const candidate = actual[label];
    if (
      typeof value === 'boolean'
        ? candidate !== value
        : String(candidate).toLowerCase() !== String(value).toLowerCase()
    ) {
      throw new Error(`Confirmed transaction ${label} does not match this workflow`);
    }
  }
}
