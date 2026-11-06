import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connector } from 'wagmi';
import { hasWalletHistory, warmConnectorsWhenIdle } from './walletWarmup';

const connectorWith = (getProvider: () => Promise<unknown>) =>
  ({ getProvider }) as unknown as Connector;

describe('wallet history', () => {
  beforeEach(() => localStorage.clear());

  it('is empty for someone who has never connected', () => {
    expect(hasWalletHistory()).toBe(false);
  });

  it('ignores the store wagmi writes for every visitor', () => {
    localStorage.setItem(
      'wagmi.store',
      JSON.stringify({ state: { current: null, chainId: 42161 } }),
    );
    expect(hasWalletHistory()).toBe(false);
  });

  it('remembers the last connector', () => {
    localStorage.setItem('wagmi.recentConnectorId', '"metaMaskConnect"');
    expect(hasWalletHistory()).toBe(true);
  });

  it('notices a persisted connection', () => {
    localStorage.setItem('wagmi.store', JSON.stringify({ state: { current: 'uid-1' } }));
    expect(hasWalletHistory()).toBe(true);
  });

  it('reconnects when storage cannot be read, rather than lose a session', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(hasWalletHistory(blocked)).toBe(true);
  });
});

describe('warming the wallet SDKs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('waits for the page to settle', () => {
    const getProvider = vi.fn(async () => ({}));
    warmConnectorsWhenIdle([connectorWith(getProvider)]);

    expect(getProvider).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(getProvider).toHaveBeenCalledTimes(1);
  });

  it('does not treat a page waiting on the chain as settled', () => {
    const getProvider = vi.fn(async () => ({}));
    const requestIdleCallback = vi.fn((callback: () => void) => {
      callback();
      return 1;
    });
    vi.stubGlobal('requestIdleCallback', requestIdleCallback);
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    warmConnectorsWhenIdle([connectorWith(getProvider)]);

    vi.advanceTimersByTime(4_999);
    expect(requestIdleCallback).not.toHaveBeenCalled();
    expect(getProvider).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(getProvider).toHaveBeenCalledTimes(1);
  });

  it('does not wait once someone starts tapping', () => {
    const getProvider = vi.fn(async () => ({}));
    warmConnectorsWhenIdle([connectorWith(getProvider)]);

    window.dispatchEvent(new Event('pointerdown'));
    expect(getProvider).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_000);
    expect(getProvider).toHaveBeenCalledTimes(1);
  });

  it('survives a connector that fails or has no provider', async () => {
    const good = vi.fn(async () => ({}));
    const connectors = [
      connectorWith(() => Promise.reject(new Error('sdk failed'))),
      {} as Connector,
      connectorWith(good),
    ];
    warmConnectorsWhenIdle(connectors);
    vi.advanceTimersByTime(5_000);
    await vi.runAllTimersAsync();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('stops if the page goes away first', () => {
    const getProvider = vi.fn(async () => ({}));
    const stop = warmConnectorsWhenIdle([connectorWith(getProvider)]);

    stop();
    vi.advanceTimersByTime(10_000);
    window.dispatchEvent(new Event('pointerdown'));
    expect(getProvider).not.toHaveBeenCalled();
  });
});
