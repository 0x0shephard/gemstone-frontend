import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import { OperationsAccessGate } from '@/components/operations/OperationsAccessGate';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TxButton } from '@/components/tx/TxButton';
import { explorerTxUrl } from '@/config/chains';
import { shortenAddress } from '@/lib/format';
import { gemLabel, gemTokenLabel, parseGemNumbers, resolveGemTokens } from '@/lib/gemNumbers';
import { qrMatrix } from '@/lib/qr';
import { dataService, tokenIdForGem } from '@/services';
import {
  addPromotionTokens,
  createPromotion,
  listPromotions,
  promoClaimUrl,
  updatePromotion,
  type PromoAdminView,
  type PromoCampaign,
} from '@/services/offchain/promo';

/**
 * Promotional codes (FIRST100): create a code, fill its pool with tokens held in
 * the operator escrow wallet, and print its QR code.
 */
export default function PromotionsPage() {
  return (
    <OperationsAccessGate capability="admin.correct">
      <Promotions />
    </OperationsAccessGate>
  );
}

function Promotions() {
  const query = useQuery({ queryKey: ['operations', 'promotions'], queryFn: listPromotions });

  if (query.isLoading) return <Skeleton className="h-[420px]" />;
  if (query.isError || !query.data) {
    return (
      <ErrorState
        message={
          query.error instanceof Error ? query.error.message : 'Promotions could not be loaded.'
        }
      />
    );
  }

  const view = query.data;
  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-[24px] font-medium tracking-[-0.03em] text-ink">
          Promotional codes
        </h2>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
          A code gives each new collector one token from its pool, free. Tokens in a pool must be
          held by the operator escrow wallet{' '}
          <span className="font-mono">{shortenAddress(view.operatorWallet)}</span>. Each email,
          account and wallet can claim once per code.
        </p>
      </header>

      {view.campaigns.length === 0 ? (
        <EmptyState title="No promotions yet" hint="Create the first code below." />
      ) : (
        view.campaigns.map((campaign) => (
          <CampaignCard key={campaign.id} campaign={campaign} view={view} />
        ))
      )}

      <CreateCampaign />
    </div>
  );
}

function CampaignCard({ campaign, view }: { campaign: PromoCampaign; view: PromoAdminView }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['operations', 'promotions'] });
  const toggle = useMutation({
    mutationFn: () => updatePromotion({ campaignId: campaign.id, active: !campaign.active }),
    onSuccess: refresh,
  });
  const pool = view.pool.filter((row) => row.campaign_id === campaign.id);
  const claims = view.claims.filter((row) => row.campaign_id === campaign.id);
  // Claims record only the token; its gem was captured when the token was pooled.
  const gemByToken = new Map(view.pool.map((row) => [row.token_id, row.gem_id]));
  const link = promoClaimUrl(campaign.code);

  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-atelier">
            {campaign.code}
          </div>
          <h3 className="mt-1 text-[16px] font-semibold text-ink">{campaign.title}</h3>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            {campaign.claimed} claimed · {campaign.remaining} available · {campaign.pooled} in pool
            · limit {campaign.max_claims}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge tone={campaign.state === 'open' ? 'success' : 'neutral'} dot>
            {campaign.state === 'open'
              ? 'Open'
              : campaign.state === 'sold_out'
                ? 'Sold out'
                : 'Closed'}
          </StatusBadge>
          <Button
            size="sm"
            variant="secondary"
            disabled={toggle.isPending}
            onClick={() => toggle.mutate()}
          >
            {campaign.active ? 'Close code' : 'Reopen code'}
          </Button>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-[200px_minmax(0,1fr)]">
        <QrBlock code={campaign.code} link={link} />
        <AddTokens campaignId={campaign.id} operatorWallet={view.operatorWallet as Address} />
      </div>

      {pool.length > 0 && (
        <p className="text-[12px] text-ink-muted">
          Pool: {pool.map((row) => gemTokenLabel(row.gem_id, row.token_id)).join(', ')}
        </p>
      )}

      {claims.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="text-ink-dim">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Stone</th>
                <th className="py-1.5 pr-3 font-medium">Email</th>
                <th className="py-1.5 pr-3 font-medium">Wallet</th>
                <th className="py-1.5 pr-3 font-medium">Status</th>
                <th className="py-1.5 font-medium">When</th>
              </tr>
            </thead>
            <tbody className="text-ink-muted">
              {claims.map((claim) => (
                <tr key={claim.token_id} className="border-t border-line/[0.06]">
                  <td className="py-1.5 pr-3 font-mono">
                    {gemTokenLabel(gemByToken.get(claim.token_id), claim.token_id)}
                  </td>
                  <td className="py-1.5 pr-3">{claim.email}</td>
                  <td className="py-1.5 pr-3 font-mono">{shortenAddress(claim.wallet)}</td>
                  <td className="py-1.5 pr-3">
                    {claim.gift_cards?.claim_tx_hash ? (
                      <a
                        href={explorerTxUrl(claim.gift_cards.claim_tx_hash)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald hover:underline"
                      >
                        {claim.gift_cards.status} ↗
                      </a>
                    ) : (
                      (claim.gift_cards?.status ?? '—')
                    )}
                  </td>
                  <td className="py-1.5">{new Date(claim.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const QR_PIXELS = 1024;

function QrBlock({ code, link }: { code: string; link: string }) {
  const { path, modules } = useMemo(() => qrMatrix(link), [link]);
  const quiet = 4;
  const size = modules + quiet * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path transform="translate(${quiet} ${quiet})" fill="#000" d="${path}"/></svg>`;

  function download(href: string, name: string) {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = name;
    anchor.click();
  }

  function downloadSvg() {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    download(url, `digital-carat-${code}.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadPng() {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = QR_PIXELS;
      canvas.height = QR_PIXELS;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0, QR_PIXELS, QR_PIXELS);
      download(canvas.toDataURL('image/png'), `digital-carat-${code}.png`);
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        shapeRendering="crispEdges"
        role="img"
        aria-label={`QR code for ${link}`}
        className="aspect-square w-full max-w-[200px] rounded-[4px]"
      >
        <rect width={size} height={size} fill="#fff" />
        <path transform={`translate(${quiet} ${quiet})`} fill="#000" d={path} />
      </svg>
      <div className="break-all font-mono text-[10.5px] text-ink-dim">{link}</div>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={downloadPng}>
          PNG
        </Button>
        <Button size="sm" variant="secondary" onClick={downloadSvg}>
          SVG
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(link)}>
          Copy link
        </Button>
      </div>
    </div>
  );
}

function AddTokens({
  campaignId,
  operatorWallet,
}: {
  campaignId: string;
  operatorWallet: Address;
}) {
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const [input, setInput] = useState('');
  const [outcome, setOutcome] = useState<{
    added: string[];
    refused: Array<{ tokenId: string; reason: string }>;
    /** DGE numbers that never reached the pool check: missing or not minted. */
    unresolved: string[];
    gemByToken: Map<string, string>;
  } | null>(null);

  const gemIds = parseGemNumbers(input);
  const add = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error('Connect the wallet the tokens come from first.');
      const resolved = await resolveGemTokens(gemIds, tokenIdForGem);
      const gemByToken = new Map<string, string>();
      const unresolved: string[] = [];
      for (const row of resolved) {
        if (row.tokenId === undefined)
          unresolved.push(row.problem ?? `${gemLabel(row.gemId)} could not be read`);
        else gemByToken.set(row.tokenId.toString(), row.gemId.toString());
      }
      const tokenIds = [...gemByToken.keys()];
      const result =
        tokenIds.length > 0
          ? await addPromotionTokens({ campaignId, tokenIds, depositedFrom: address })
          : { added: [], refused: [] };
      return { ...result, unresolved, gemByToken };
    },
    onSuccess: async (result) => {
      setOutcome(result);
      await queryClient.invalidateQueries({ queryKey: ['operations', 'promotions'] });
    },
  });
  const stoneName = (tokenId: string) => {
    const gemId = outcome?.gemByToken.get(tokenId);
    return gemId ? gemLabel(gemId) : `token #${tokenId}`;
  };
  const notInEscrow = (outcome?.refused ?? []).filter((row) =>
    row.reason.includes('operator escrow'),
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    add.mutate();
  }

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="space-y-2.5">
        <Field
          label="Add stones to the pool"
          placeholder="DGE-16, DGE-17"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <p className="text-[11.5px] leading-relaxed text-ink-dim">
          Connect the wallet that holds the tokens (
          {address ? <span className="font-mono">{shortenAddress(address)}</span> : 'not connected'}
          ). Tokens not yet in escrow can be moved below, one transaction each. A cancelled claim
          returns its stone to this wallet.
        </p>
        <Button type="submit" size="sm" disabled={gemIds.length === 0 || add.isPending || !address}>
          {add.isPending ? 'Checking…' : `Add ${gemIds.length || ''} to pool`}
        </Button>
      </form>

      {add.error instanceof Error && <p className="text-[12px] text-ruby">{add.error.message}</p>}
      {outcome && (
        <div className="space-y-2 text-[12px]">
          {outcome.added.length > 0 && (
            <p className="text-emerald">
              Added:{' '}
              {outcome.added.map((id) => gemTokenLabel(outcome.gemByToken.get(id), id)).join(', ')}
            </p>
          )}
          {outcome.unresolved.map((problem) => (
            <p key={problem} className="text-amber">
              {problem}
            </p>
          ))}
          {outcome.refused
            .filter((row) => !row.reason.includes('operator escrow'))
            .map((row) => (
              <p key={row.tokenId} className="text-amber">
                {gemTokenLabel(outcome.gemByToken.get(row.tokenId), row.tokenId)}: {row.reason}
              </p>
            ))}
          {notInEscrow.length > 0 && (
            <div className="space-y-2">
              <p className="text-ink-muted">
                Not in escrow yet. Move each from your wallet, then press Add again:
              </p>
              {notInEscrow.map((row) => (
                <TxButton
                  key={row.tokenId}
                  size="sm"
                  variant="secondary"
                  action={() =>
                    dataService.transferToken({ tokenId: BigInt(row.tokenId), to: operatorWallet })
                  }
                  pendingLabel={`Moving ${stoneName(row.tokenId)}…`}
                  doneLabel={`${stoneName(row.tokenId)} moved`}
                  telemetryFlow="promo_escrow"
                >
                  Move {stoneName(row.tokenId)} to escrow
                </TxButton>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CreateCampaign() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('FIRST100');
  const [title, setTitle] = useState('Buy your first token. Receive this one free.');
  const [message, setMessage] = useState('');
  const [maxClaims, setMaxClaims] = useState(19);
  const create = useMutation({
    mutationFn: (event: FormEvent) => {
      event.preventDefault();
      return createPromotion({ code, title, message: message || undefined, maxClaims });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['operations', 'promotions'] }),
  });

  return (
    <Card className="space-y-3 p-5">
      <h3 className="text-[15px] font-semibold text-ink">New promotional code</h3>
      <form onSubmit={(event) => create.mutate(event)} className="grid gap-3 sm:grid-cols-2">
        <Field label="Code" value={code} onChange={(event) => setCode(event.target.value)} />
        <Field
          label="Claim limit"
          type="number"
          min="1"
          value={maxClaims}
          onChange={(event) => setMaxClaims(Number(event.target.value))}
        />
        <div className="sm:col-span-2">
          <Field label="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Field
            label="Message (optional)"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create code'}
          </Button>
          {create.error instanceof Error && (
            <p className="mt-2 text-[12px] text-ruby">{create.error.message}</p>
          )}
        </div>
      </form>
    </Card>
  );
}
