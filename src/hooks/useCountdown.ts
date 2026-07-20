import { useEffect, useState } from 'react';

/**
 * Ticks a countdown from an initial seconds value down to zero.
 * Returns the remaining seconds; recomputes if `initialSeconds` changes.
 */
export function useCountdown(initialSeconds: number): number {
  const [seconds, setSeconds] = useState(Math.max(0, initialSeconds));

  useEffect(() => {
    setSeconds(Math.max(0, initialSeconds));
    if (initialSeconds <= 0) return;
    const id = setInterval(() => {
      setSeconds((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [initialSeconds]);

  return seconds;
}
