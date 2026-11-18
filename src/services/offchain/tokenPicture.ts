import { invokeEdgeFunction } from './invoke';

export interface TokenPicture {
  tokenId: string;
  gemId: string;
  owner: string;
  tokenUri: string;
  name: string | null;
  image: string | null;
  /** Whether the operator wallet holds METADATA_ROLE on DGENFT yet. */
  canEdit: boolean;
  operator: string;
  previousImage?: string | null;
  transactionHash?: string;
}

export function inspectTokenPicture(tokenId: string): Promise<TokenPicture> {
  return invokeEdgeFunction<TokenPicture>('v1-token-picture', { action: 'inspect', tokenId });
}

/** Pinning, verification and the on-chain update take a while; allow two minutes. */
export async function replaceTokenPicture(tokenId: string, file: File): Promise<TokenPicture> {
  const image = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The image could not be read'));
    reader.readAsDataURL(file);
  });
  return invokeEdgeFunction<TokenPicture>(
    'v1-token-picture',
    { action: 'replace', tokenId, image, contentType: file.type },
    120_000,
  );
}
