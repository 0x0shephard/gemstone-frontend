import { keccak256, toBytes, type Hash } from 'viem';

function serialize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('Canonical JSON cannot contain non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${serialize(child)}`)
      .join(',')}}`;
  }
  throw new Error(`Unsupported canonical JSON type: ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return serialize(value);
}

export function canonicalKeccak(value: unknown): Hash {
  return keccak256(toBytes(canonicalJson(value)));
}
