export type RedemptionMethod = 'pickup' | 'insured_delivery';

function required(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`);
  return value.trim().replace(/\s+/g, ' ');
}

/** Allowlisted, deterministic private fulfillment record committed on-chain by hash. */
export function normalizedFulfillmentDetails(
  method: RedemptionMethod,
  value: unknown,
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Fulfillment details are required');
  }
  const source = value as Record<string, unknown>;
  if (method === 'pickup') return { pickupLocation: required(source, 'pickupLocation') };
  const normalized: Record<string, string> = {
    recipientName: required(source, 'recipientName'),
    addressLine1: required(source, 'addressLine1'),
    city: required(source, 'city'),
    postalCode: required(source, 'postalCode'),
    country: required(source, 'country'),
  };
  for (const key of ['addressLine2', 'region']) {
    const optional = typeof source[key] === 'string' ? source[key].trim().replace(/\s+/g, ' ') : '';
    if (optional) normalized[key] = optional;
  }
  return normalized;
}

/** JSONB does not preserve object key order, so idempotency compares canonical values. */
export function sameFulfillmentDetails(left: unknown, right: unknown): boolean {
  if (!left || typeof left !== 'object' || Array.isArray(left)) return false;
  if (!right || typeof right !== 'object' || Array.isArray(right)) return false;
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    return value;
  };
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}
