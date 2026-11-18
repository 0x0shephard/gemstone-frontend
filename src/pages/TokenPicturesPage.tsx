import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { OperationsAccessGate } from '@/components/operations/OperationsAccessGate';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { explorerTxUrl } from '@/config/chains';
import { gatewayUrl, isIpfsUri, PUBLIC_IPFS_GATEWAYS } from '@/config/ipfs';
import { shortenAddress } from '@/lib/format';
import {
  inspectTokenPicture,
  replaceTokenPicture,
  type TokenPicture,
} from '@/services/offchain/tokenPicture';

const MAX_BYTES = 6 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function viewable(uri: string | null | undefined): string | undefined {
  if (!uri) return undefined;
  return isIpfsUri(uri) ? gatewayUrl(PUBLIC_IPFS_GATEWAYS[0], uri) : uri;
}

/**
 * Replaces a minted token's picture everywhere it is shown: digitalcarat.io,
 * OpenSea and wallets. Only the image changes; every other metadata field is
 * carried over, and the registry keeps the original record.
 */
export default function TokenPicturesPage() {
  return (
    <OperationsAccessGate capability="admin.correct">
      <TokenPictures />
    </OperationsAccessGate>
  );
}

function TokenPictures() {
  const [tokenId, setTokenId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [token, setToken] = useState<TokenPicture | null>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : undefined), [file]);
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  const inspect = useMutation({
    mutationFn: (id: string) => inspectTokenPicture(id),
    onSuccess: (result) => {
      setToken(result);
      setFile(null);
    },
  });
  const replace = useMutation({
    mutationFn: () => {
      if (!token || !file) throw new Error('Choose a token and an image first.');
      if (!TYPES.includes(file.type)) throw new Error('Upload a JPEG, PNG or WebP image.');
      if (file.size > MAX_BYTES) throw new Error('The image must be 6 MB or smaller.');
      return replaceTokenPicture(token.tokenId, file);
    },
    onSuccess: (result) => {
      setToken(result);
      setFile(null);
    },
  });

  function lookUp(event: FormEvent) {
    event.preventDefault();
    replace.reset();
    inspect.mutate(tokenId.replace(/^#/, '').trim());
  }

  const error = (inspect.error ?? replace.error) as Error | null;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-[24px] font-medium tracking-[-0.03em] text-ink">
          Token pictures
        </h2>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
          Replace the photo of a minted stone. The new picture shows on digitalcarat.io, OpenSea and
          wallets; every other detail of the token stays exactly as it is. Each change is an
          on-chain transaction from the operator wallet and is recorded in the audit log.
        </p>
      </header>

      <Card className="p-5">
        <form onSubmit={lookUp} className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Field
              label="Token number"
              placeholder="3"
              value={tokenId}
              onChange={(event) => setTokenId(event.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary" disabled={!tokenId.trim() || inspect.isPending}>
            {inspect.isPending ? 'Loading…' : 'Look up'}
          </Button>
        </form>
      </Card>

      {token && (
        <Card className="space-y-5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[16px] font-semibold text-ink">
                {token.name ?? `Token #${token.tokenId}`}
              </h3>
              <p className="mt-1 font-mono text-[11px] text-ink-dim">
                Token #{token.tokenId} · gem {token.gemId} · held by {shortenAddress(token.owner)}
              </p>
            </div>
            {!token.canEdit && (
              <StatusBadge tone="neutral" dot>
                Waiting for the DGENFT upgrade and METADATA_ROLE
              </StatusBadge>
            )}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <figure className="space-y-2">
              <figcaption className="text-[12px] text-ink-muted">
                {token.transactionHash ? 'New picture' : 'Current picture'}
              </figcaption>
              {viewable(token.image) ? (
                <img
                  src={viewable(token.image)}
                  alt="Current token"
                  className="aspect-square w-full rounded-[4px] object-cover"
                />
              ) : (
                <div className="aspect-square w-full rounded-[4px] bg-line/[0.06]" />
              )}
            </figure>
            <figure className="space-y-2">
              <figcaption className="text-[12px] text-ink-muted">Replacement</figcaption>
              {preview ? (
                <img
                  src={preview}
                  alt="Replacement"
                  className="aspect-square w-full rounded-[4px] object-cover"
                />
              ) : (
                <label className="flex aspect-square w-full cursor-pointer items-center justify-center rounded-[4px] border border-dashed border-line/[0.2] text-[12.5px] text-ink-muted">
                  Choose a JPEG, PNG or WebP (up to 6 MB)
                  <input
                    type="file"
                    accept={TYPES.join(',')}
                    className="sr-only"
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  />
                </label>
              )}
            </figure>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={!file || !token.canEdit || replace.isPending}
              onClick={() => replace.mutate()}
            >
              {replace.isPending ? 'Publishing and updating…' : 'Replace picture'}
            </Button>
            {file && (
              <Button variant="ghost" disabled={replace.isPending} onClick={() => setFile(null)}>
                Choose another
              </Button>
            )}
            {token.transactionHash && (
              <a
                href={explorerTxUrl(token.transactionHash)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[12px] text-emerald hover:underline"
              >
                Updated · {shortenAddress(token.transactionHash, 8)} ↗
              </a>
            )}
          </div>
          {token.transactionHash && (
            <p className="text-[12px] text-ink-muted">
              OpenSea refreshes on its own, usually within minutes; “Refresh metadata” on the item
              page forces it.
            </p>
          )}
        </Card>
      )}

      {error && (
        <p role="alert" className="text-[12.5px] text-ruby">
          {error.message}
        </p>
      )}
    </div>
  );
}
