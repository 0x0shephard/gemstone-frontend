/** Formatting helpers shared across the UI. */

export function fmtUsd(n: number, opts?: { compact?: boolean }): string {
  if (opts?.compact && Math.abs(n) >= 1000) {
    return (
      '$' +
      new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
    );
  }
  return '$' + n.toLocaleString('en-US');
}

export function fmtCarats(n: number): string {
  return n.toFixed(2) + ' ct';
}

/**
 * Renders an 18-decimal USD base-unit amount, tolerating exponential input.
 *
 * `numeric` columns arrive from PostgREST unquoted, so any that escape a
 * `::text` cast reach the browser as JS numbers. Above 1e21 their `toString()`
 * is exponential, and `BigInt()` throws on that — which took down the whole
 * seller page rather than one table cell. Queries should still cast; this makes
 * the failure a dash instead of a white screen.
 */
export function fmtUsdBaseUnits(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const text = String(value);
  try {
    return fmtUsd(Number(BigInt(text) / 10n ** 18n));
  } catch {
    const asNumber = Number(text);
    return Number.isFinite(asNumber) ? fmtUsd(Math.round(asNumber / 1e18)) : '—';
  }
}

export function fmtPct(n: number): string {
  return n.toFixed(1) + '%';
}

/** Shorten an address to 0x1234…abcd. */
export function shortenAddress(address?: string | null, chars = 4): string {
  if (!address) return '—';
  if (address.length <= 2 + chars * 2) return address;
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

/** Seconds → HH:MM:SS countdown string. */
export function fmtCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (x: number) => x.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}
