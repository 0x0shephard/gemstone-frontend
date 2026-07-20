import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAccount, useChainId } from 'wagmi';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/Button';
import { WalletStatus } from '@/components/wallet/WalletStatus';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAuth } from '@/providers/AuthProvider';
import { activeChain } from '@/config/chains';
import { shortenAddress } from '@/lib/format';

export default function OnboardingPage() {
  const { user, configured, linkedWallet, linkWallet } = useAuth();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const navigate = useNavigate();
  const wrongNetwork = isConnected && chainId !== activeChain.id;

  // Auto-link the connected address to the profile once available.
  useEffect(() => {
    if (address && address !== linkedWallet) linkWallet(address);
  }, [address, linkedWallet, linkWallet]);

  const identity = user
    ? (user.user_metadata?.full_name as string) || user.email
    : 'Guest (not signed in)';

  return (
    <AuthShell>
      <div className="w-full max-w-[460px] rounded-[16px] border border-white/[0.08] bg-card p-7">
        <h1 className="text-[22px] font-bold text-ink">Connect your wallet</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          Link an EVM wallet to your profile to trade, bid and redeem.
        </p>

        {/* Signed-in identity */}
        <div className="mt-6 rounded-[12px] border border-white/[0.08] bg-panel p-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-ink-dim">
            App account
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[14px] font-semibold text-ink">{identity}</span>
            {configured && user ? (
              <StatusBadge tone="success" dot>
                Signed in
              </StatusBadge>
            ) : (
              <Link to="/login" className="text-[12.5px] text-ink-soft hover:text-ink">
                Sign in →
              </Link>
            )}
          </div>
        </div>

        {/* Wallet */}
        <div className="mt-4 rounded-[12px] border border-white/[0.08] bg-panel p-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-ink-dim">Wallet</div>
          <div className="mt-3">
            <WalletStatus variant="full" />
          </div>

          {wrongNetwork && (
            <div
              className="mt-3 rounded-[8px] px-3 py-2 text-[12px]"
              style={{ background: 'rgba(229,72,77,.06)', border: '1px solid rgba(229,72,77,.28)', color: '#F0B8BA' }}
            >
              Wrong network — switch to <strong>{activeChain.name}</strong> to continue.
            </div>
          )}

          {isConnected && !wrongNetwork && (
            <div className="mt-3 flex items-center gap-2 text-[12.5px] text-emerald">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald" />
              Linked {shortenAddress(address)} to your profile.
            </div>
          )}
        </div>

        <Button
          size="lg"
          block
          className="mt-6"
          disabled={!isConnected || wrongNetwork}
          onClick={() => navigate('/marketplace')}
        >
          Enter the marketplace
        </Button>
        <button
          onClick={() => navigate('/marketplace')}
          className="mt-3 w-full text-center text-[12.5px] text-ink-muted hover:text-ink"
        >
          Skip for now →
        </button>
      </div>
    </AuthShell>
  );
}
