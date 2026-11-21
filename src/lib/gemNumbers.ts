/**
 * Staff and collectors know a stone by its DGE number, the GemRegistry gem id
 * shown everywhere on the site. Tokens are numbered separately and only when a
 * stone is minted; auction stones get theirs when they sell. The two sequences
 * have drifted apart (DGE-14 is token #10), so admin screens take DGE numbers
 * and resolve the token themselves rather than asking anyone to translate.
 */

/**
 * DGE numbers from free text: "DGE-14, DGE-15", "dge 14 15" and "14, 15" all
 * read as gems 14 and 15. Order is kept and repeats are dropped.
 */
export function parseGemNumbers(input: string): bigint[] {
  const seen = new Set<string>();
  const gems: bigint[] = [];
  for (const match of input.matchAll(/(?:dge[\s-]*)?(\d{1,10})/gi)) {
    const value = match[1].replace(/^0+/, '');
    if (!value || seen.has(value)) continue;
    seen.add(value);
    gems.push(BigInt(value));
  }
  return gems;
}

export function gemLabel(gemId: bigint | string): string {
  return `DGE-${gemId}`;
}

/** "DGE-14 · token #10", or the token alone when its gem is unknown. */
export function gemTokenLabel(
  gemId: bigint | string | null | undefined,
  tokenId: bigint | string,
): string {
  return gemId === null || gemId === undefined || String(gemId) === '0'
    ? `token #${tokenId}`
    : `${gemLabel(gemId)} · token #${tokenId}`;
}

export interface GemTokenResolution {
  gemId: bigint;
  tokenId?: bigint;
  /** Why the gem has no usable token, in words for the operator. */
  problem?: string;
}

/**
 * Resolves each DGE number to its token. A missing gem or an unminted one is
 * reported per stone instead of failing the whole batch.
 */
export async function resolveGemTokens(
  gemIds: bigint[],
  tokenIdForGem: (gemId: bigint) => Promise<bigint>,
): Promise<GemTokenResolution[]> {
  return Promise.all(
    gemIds.map(async (gemId) => {
      try {
        return { gemId, tokenId: await tokenIdForGem(gemId) };
      } catch (error) {
        return {
          gemId,
          problem: error instanceof Error ? error.message : `${gemLabel(gemId)} could not be read`,
        };
      }
    }),
  );
}
