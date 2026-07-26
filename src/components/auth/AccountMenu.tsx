import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useChainId } from 'wagmi';
import type { Address } from 'viem';
import { activeChain } from '@/config/chains';
import { shortenAddress } from '@/lib/format';
import { useAuth } from '@/providers/AuthProvider';
import { cn } from '@/lib/cn';

interface AccountMenuProps {
  className?: string;
}

export function AccountMenu({ className }: AccountMenuProps) {
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState('');
  const { user, loading, linkedWallet, signOut, linkWallet } = useAuth();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  const name =
    (user?.user_metadata?.full_name as string | undefined) ||
    user?.email?.split('@')[0] ||
    'Account';
  const initials = name
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  const wrongNetwork = isConnected && chainId !== activeChain.id;
  const walletVerified = Boolean(address && linkedWallet?.toLowerCase() === address.toLowerCase());

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  async function verifyWallet(walletAddress: Address) {
    setMessage('');
    setVerifying(true);
    let result = await linkWallet(walletAddress);
    if (result.requiresConfirmation) {
      const confirmed = window.confirm(
        'This profile already has a primary wallet. Replace it with the connected wallet?',
      );
      if (confirmed) result = await linkWallet(walletAddress, true);
      else result = { ok: false, message: 'Wallet relinking cancelled.' };
    }
    setMessage(result.message);
    setVerifying(false);
  }

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    setOpen(false);
    setSigningOut(false);
    navigate('/', { replace: true });
  }

  if (loading) {
    return (
      <span
        className={cn(
          'h-10 w-10 animate-pulse rounded-[4px] border border-white/[0.08] bg-white/[0.035]',
          className,
        )}
        aria-label="Loading account"
      />
    );
  }

  if (!user) {
    return (
      <Link
        to="/login"
        className={cn(
          'dc-btn-anim inline-flex h-10 items-center rounded-[4px] border border-white/[0.12] bg-white/[0.035] px-3.5 text-[12.5px] font-semibold text-ink hover:bg-white/[0.065]',
          className,
        )}
      >
        Sign in
      </Link>
    );
  }

  return (
    <div ref={menuRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="group flex h-10 items-center gap-2 rounded-[4px] border border-atelier/25 bg-atelier/[0.07] p-1.5 pr-2.5 text-left transition-all hover:border-atelier/45 hover:bg-atelier/[0.11] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-atelier/55"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Open account menu"
      >
        <span className="flex h-7 w-7 rotate-45 items-center justify-center rounded-[4px] border border-atelier/35 bg-atelier/[0.12]">
          <span className="-rotate-45 font-mono text-[9.5px] font-semibold text-ink">
            {initials || 'DC'}
          </span>
        </span>
        <span className="hidden min-w-0 sm:block">
          <span className="block max-w-24 truncate text-[11.5px] font-semibold leading-none text-ink">
            {name}
          </span>
          <span className="mt-1 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.12em] text-emerald">
            <span className="h-1 w-1 rounded-full bg-emerald shadow-[0_0_7px_var(--dc-emerald)]" />
            Signed in
          </span>
        </span>
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className={cn(
            'hidden h-3 w-3 text-ink-dim transition-transform sm:block',
            open && 'rotate-180',
          )}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>

      {open && (
        <section
          role="dialog"
          aria-label="Account and wallet"
          className="absolute right-0 top-[calc(100%+10px)] z-50 w-[min(340px,calc(100vw-24px))] animate-dcslideup overflow-hidden rounded-[4px] border border-white/[0.12] bg-elevated shadow-[0_24px_80px_rgba(0,0,0,.65)]"
        >
          <div className="dc-facet-border border-b border-white/[0.07] p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 rotate-45 items-center justify-center rounded-[4px] border border-atelier/30 bg-atelier/[0.09]">
                <span className="-rotate-45 font-mono text-[11px] font-semibold text-ink">
                  {initials || 'DC'}
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-ink">{name}</p>
                <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">{user.email}</p>
                <p className="mt-2 inline-flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.13em] text-emerald">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald" />
                  Signed in
                </p>
              </div>
            </div>
          </div>

          <div className="p-3">
            <div className="rounded-[4px] border border-white/[0.08] bg-white/[0.025] p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
                    Trading wallet
                  </p>
                  <p className="mt-1 text-[12px] text-ink-muted">
                    {isConnected
                      ? wrongNetwork
                        ? 'Wrong network'
                        : walletVerified
                          ? 'Connected and verified'
                          : 'Connected · verification required'
                      : 'Not connected'}
                  </p>
                </div>
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    isConnected && !wrongNetwork ? 'bg-emerald' : 'bg-amber',
                  )}
                />
              </div>

              <ConnectButton.Custom>
                {({ openAccountModal, openChainModal, openConnectModal }) => (
                  <div className="mt-3">
                    {!isConnected ? (
                      <button
                        type="button"
                        onClick={openConnectModal}
                        className="dc-btn-anim flex h-10 w-full items-center justify-center rounded-[4px] bg-atelier px-3 text-[12.5px] font-semibold text-vault"
                      >
                        Connect wallet
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={wrongNetwork ? openChainModal : openAccountModal}
                          className="flex w-full items-center justify-between rounded-[4px] border border-white/[0.09] bg-black/10 px-3 py-2.5 text-left hover:border-white/[0.16]"
                        >
                          <span>
                            <span className="block font-mono text-[12px] text-ink">
                              {shortenAddress(address)}
                            </span>
                            <span className="mt-0.5 block text-[10.5px] text-ink-dim">
                              {wrongNetwork ? 'Switch network' : activeChain.name}
                            </span>
                          </span>
                          <span className="text-[11px] text-ink-muted">
                            {wrongNetwork ? 'Fix →' : 'Manage →'}
                          </span>
                        </button>
                        {!wrongNetwork && !walletVerified && address && (
                          <button
                            type="button"
                            disabled={verifying}
                            onClick={() => void verifyWallet(address)}
                            className="dc-btn-anim mt-2 flex h-9 w-full items-center justify-center rounded-[4px] border border-atelier/35 bg-atelier/[0.08] px-3 text-[11.5px] font-semibold text-ink disabled:opacity-50"
                          >
                            {verifying ? 'Waiting for signature…' : 'Verify wallet with SIWE'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </ConnectButton.Custom>
              {message && (
                <p
                  className={cn(
                    'mt-2 text-[11px]',
                    walletVerified ? 'text-emerald' : 'text-ink-muted',
                  )}
                  role="status"
                >
                  {message}
                </p>
              )}
            </div>

            <Link
              to="/profile"
              onClick={() => setOpen(false)}
              className="mt-2 flex h-10 items-center justify-between rounded-[4px] px-3 text-[12.5px] font-medium text-ink-muted hover:bg-white/[0.035] hover:text-ink"
            >
              Portfolio and activity <span aria-hidden>→</span>
            </Link>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
              className="flex h-10 w-full items-center justify-between rounded-[4px] px-3 text-left text-[12.5px] font-medium text-ruby hover:bg-ruby/[0.07] disabled:opacity-50"
            >
              {signingOut ? 'Signing out…' : 'Sign out'} <span aria-hidden>↗</span>
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
