import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useChainId } from 'wagmi';
import type { Address } from 'viem';
import { activeChain } from '@/config/chains';
import { shortenAddress } from '@/lib/format';
import { useAuth } from '@/providers/AuthProvider';
import { cn } from '@/lib/cn';
import { detectWalletEnvironment } from '@/providers/walletSelection';
import { WalletAddress } from '@/components/wallet/WalletAddress';
import { isWalletConnectConnector } from '@/services/chain/walletConnectRouting';

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
  // Set when the server asks whether to replace an existing primary wallet.
  const [relinkFor, setRelinkFor] = useState<Address | null>(null);
  const { user, loading, linkedWallet, signOut, linkWallet } = useAuth();
  const { address, connector, isConnected } = useAccount();
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
  // A multichain WalletConnect session routes each request explicitly. Its
  // wallet UI can stay on mainnet while the app safely signs on Sepolia.
  const wrongNetwork =
    isConnected && !isWalletConnectConnector(connector) && chainId !== activeChain.id;
  /*
   * A touch device with no injected provider: a phone browser rather than a
   * wallet's in-app browser, which is the only configuration where connecting
   * requires leaving the app.
   */
  const [showInAppBrowserHint] = useState(() => {
    const environment = detectWalletEnvironment(false);
    return environment.touchPrimary && !environment.hasInjected;
  });
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

  /*
   * Asked in the page, not through `window.confirm`.
   *
   * A wallet's in-app browser is where this matters most — it is the one place
   * connecting works smoothly — and a webview may suppress a native dialog
   * entirely. A confirmation nobody sees reads as a signature that silently did
   * nothing, and the relink can never be completed.
   *
   * Each attempt costs a signature, so the question is asked once and the answer
   * carried into the second call.
   */
  async function verifyWallet(walletAddress: Address, confirmRelink = false) {
    setMessage('');
    setRelinkFor(null);
    setVerifying(true);
    const result = await linkWallet(walletAddress, confirmRelink);
    if (result.requiresConfirmation) {
      setRelinkFor(walletAddress);
      setMessage('');
    } else {
      setMessage(result.message);
    }
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
          'h-10 w-10 animate-pulse rounded-[4px] border border-line/[0.08] bg-line/[0.035]',
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
          'dc-btn-anim inline-flex h-10 items-center rounded-[4px] border border-line/[0.12] bg-line/[0.035] px-3.5 text-[12.5px] font-semibold text-ink hover:bg-line/[0.065]',
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
          className="dc-header-popover dc-header-popover-account z-50 animate-dcslideup overflow-x-hidden overflow-y-auto overscroll-contain rounded-[4px] border border-line/[0.12] bg-elevated shadow-[0_24px_80px_rgba(0,0,0,.65)]"
        >
          <div className="dc-facet-border border-b border-line/[0.07] p-4">
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
            <div className="rounded-[4px] border border-line/[0.08] bg-line/[0.025] p-3.5">
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
                      <>
                        <button
                          type="button"
                          onClick={openConnectModal}
                          className="dc-btn-anim flex h-10 w-full items-center justify-center rounded-[4px] bg-atelier px-3 text-[12.5px] font-semibold text-vault"
                        >
                          Connect wallet
                        </button>
                        {/*
                          Only on a phone that has no wallet of its own, which is
                          the one place connecting means leaving the browser
                          entirely. That hand-off is where it goes wrong: the
                          wallet approves, the reply is published to a relay, and
                          the tab it was meant for may have been closed by the
                          operating system while it sat in the background.

                          Opening the site inside the wallet's own browser
                          removes the hand-off rather than working around it —
                          there is no app switch, no relay, and the wallet is
                          simply present on the page.
                        */}
                        {showInAppBrowserHint && (
                          <p className="mt-2 text-[11px] leading-relaxed text-ink-dim">
                            Trouble connecting on your phone? Open{' '}
                            <span className="font-semibold text-ink-muted">digitalcarat.io</span> in
                            your wallet app’s own browser — MetaMask has one under Browse — and it
                            connects without switching apps.
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={wrongNetwork ? openChainModal : openAccountModal}
                          className="flex w-full items-center justify-between rounded-[4px] border border-line/[0.09] bg-black/10 px-3 py-2.5 text-left hover:border-line/[0.16]"
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
                        {/*
                          The full address, copyable. Everything above shows a
                          shortened form, which is unusable for the commonest
                          task there is: giving somebody the address so they can
                          send you a token.
                        */}
                        {address && !wrongNetwork && (
                          <div className="mt-2 rounded-[4px] border border-line/[0.09] bg-line/[0.02] p-2.5">
                            <WalletAddress address={address} label="Your receiving address" />
                          </div>
                        )}
                        {/*
                          Said rather than left blank. The verify button hides on
                          the wrong network, which on its own reads as the step
                          having vanished — and this is the state a WalletConnect
                          session lands in, since it brings whatever chain the
                          wallet already had.
                        */}
                        {wrongNetwork && !walletVerified && address && (
                          <p className="mt-2 rounded-[4px] border border-amber/25 bg-amber/[0.06] p-2.5 text-[11.5px] leading-relaxed text-ink">
                            Your wallet is on a different network. Switch it to {activeChain.name} —
                            use “Fix” above, or change networks in your wallet — and the
                            verification step will appear.
                          </p>
                        )}
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
                        {/*
                          The question the server asked, put where it can be
                          seen and answered. Replacing a primary wallet is not
                          reversible from here, so it is stated plainly and
                          neither button is the default.
                        */}
                        {relinkFor && (
                          <div className="mt-2 rounded-[4px] border border-amber/25 bg-amber/[0.06] p-2.5">
                            <p className="text-[11.5px] leading-relaxed text-ink">
                              This account already has a verified wallet. Replacing it makes the
                              connected wallet your primary one — gifts, offers and redemptions will
                              follow it from now on.
                            </p>
                            <div className="mt-2 flex gap-2">
                              <button
                                type="button"
                                disabled={verifying}
                                onClick={() => void verifyWallet(relinkFor, true)}
                                className="h-8 flex-1 rounded-[4px] border border-atelier/35 bg-atelier/[0.1] text-[11.5px] font-semibold text-ink disabled:opacity-50"
                              >
                                Replace it
                              </button>
                              <button
                                type="button"
                                disabled={verifying}
                                onClick={() => {
                                  setRelinkFor(null);
                                  setMessage('Wallet relinking cancelled.');
                                }}
                                className="h-8 flex-1 rounded-[4px] border border-line/[0.12] text-[11.5px] font-medium text-ink-muted disabled:opacity-50"
                              >
                                Keep the old one
                              </button>
                            </div>
                          </div>
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
              className="mt-2 flex h-10 items-center justify-between rounded-[4px] px-3 text-[12.5px] font-medium text-ink-muted hover:bg-line/[0.035] hover:text-ink"
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
