import type { Page } from '@playwright/test';
import { createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * An injected EIP-1193 wallet backed by the local anvil node.
 *
 * The app sees an ordinary browser wallet (`window.ethereum`), so the real
 * RainbowKit/wagmi connect path runs. Anvil holds the development keys, so
 * signing and sending are plain RPC forwards — no key ever enters the page.
 *
 * Tests steer it through `window.__e2eWallet`:
 *   setAccount(address)       switch the connected account (emits accountsChanged)
 *   rejectNext(method)        the next call of `method` fails with EIP-1193 4001
 *   loseNextResponse(method)  forward the next call, then fail as if the network
 *                             dropped the reply — the ambiguous-broadcast case
 *   setChainId(hex)           report a different network (wrong-chain tests)
 *   calls                     every method the app requested, in order
 */
export interface TestWalletOptions {
  rpcUrl: string;
  account: string;
  /**
   * Sign in the Node test process instead of relying on an unlocked node
   * account — for live networks (the canary). The key never enters the page.
   */
  privateKey?: Hex;
}

const SIGNING = ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4'];

export async function installTestWallet(page: Page, options: TestWalletOptions) {
  if (options.privateKey) {
    const signer = createWalletClient({
      account: privateKeyToAccount(options.privateKey),
      transport: http(options.rpcUrl),
    });
    await page.exposeFunction('__e2eSign', async (method: string, params: unknown[]) => {
      if (method === 'personal_sign') {
        return signer.signMessage({ message: { raw: params[0] as Hex } });
      }
      if (method === 'eth_signTypedData_v4') {
        return signer.signTypedData(JSON.parse(params[1] as string));
      }
      const [tx] = params as [Record<string, string>];
      return signer.sendTransaction({
        chain: null,
        to: tx.to as Hex,
        data: tx.data as Hex | undefined,
        value: tx.value ? BigInt(tx.value) : undefined,
        gas: tx.gas ? BigInt(tx.gas) : undefined,
      });
    });
  }
  await page.addInitScript(
    ({ rpcUrl, account, signing, localSigner }) => {
      type Listener = (...args: unknown[]) => void;
      const listeners = new Map<string, Set<Listener>>();
      const state = {
        account,
        chainId: '0xaa36a7',
        reject: new Set<string>(),
        lose: new Set<string>(),
        calls: [] as string[],
      };
      let id = 0;

      const emit = (event: string, value: unknown) =>
        listeners.get(event)?.forEach((listener) => listener(value));

      const forward = async (method: string, params: unknown[]) => {
        const response = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: (id += 1), method, params }),
        });
        const body = (await response.json()) as {
          result?: unknown;
          error?: { code: number; message: string; data?: unknown };
        };
        if (body.error) {
          throw Object.assign(new Error(body.error.message), body.error);
        }
        return body.result;
      };

      const provider = {
        isMetaMask: true,
        async request({ method, params = [] }: { method: string; params?: unknown[] }) {
          state.calls.push(method);
          if (state.reject.delete(method)) {
            throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
          }
          switch (method) {
            case 'eth_requestAccounts':
            case 'eth_accounts':
              return [state.account];
            case 'eth_chainId':
              return state.chainId;
            case 'net_version':
              return String(Number(state.chainId));
            case 'wallet_requestPermissions':
            case 'wallet_getPermissions':
              return [{ parentCapability: 'eth_accounts' }];
            case 'wallet_revokePermissions':
              return null;
            case 'wallet_switchEthereumChain': {
              const [{ chainId }] = params as [{ chainId: string }];
              state.chainId = chainId;
              emit('chainChanged', chainId);
              return null;
            }
            case 'wallet_addEthereumChain':
            case 'wallet_watchAsset':
              return null;
            case 'eth_sendTransaction': {
              const [tx] = params as [Record<string, unknown>];
              const result = localSigner
                ? await (
                    window as unknown as {
                      __e2eSign: (m: string, p: unknown[]) => Promise<unknown>;
                    }
                  ).__e2eSign(method, params)
                : await forward(method, [{ ...tx, from: state.account }]);
              if (state.lose.delete(method)) throw new TypeError('Failed to fetch');
              return result;
            }
            default: {
              const result =
                localSigner && signing.includes(method)
                  ? await (
                      window as unknown as {
                        __e2eSign: (m: string, p: unknown[]) => Promise<unknown>;
                      }
                    ).__e2eSign(method, params)
                  : await forward(method, params);
              if (state.lose.delete(method)) throw new TypeError('Failed to fetch');
              return result;
            }
          }
        },
        on(event: string, listener: Listener) {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)!.add(listener);
          return provider;
        },
        removeListener(event: string, listener: Listener) {
          listeners.get(event)?.delete(listener);
          return provider;
        },
      };

      Object.defineProperty(window, 'ethereum', { value: provider, configurable: true });
      Object.defineProperty(window, '__e2eWallet', {
        value: {
          get calls() {
            return [...state.calls];
          },
          setAccount(next: string) {
            state.account = next;
            emit('accountsChanged', [next]);
          },
          rejectNext(method: string) {
            state.reject.add(method);
          },
          loseNextResponse(method: string) {
            state.lose.add(method);
          },
          setChainId(next: string) {
            state.chainId = next;
            emit('chainChanged', next);
          },
        },
        configurable: true,
      });
    },
    {
      rpcUrl: options.rpcUrl,
      account: options.account,
      signing: SIGNING,
      localSigner: Boolean(options.privateKey),
    },
  );
}
