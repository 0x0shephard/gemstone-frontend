import { useCallback, useState } from 'react';
import type { DecoratedGem } from '@/services/types';
import type { GemModalState, GemModalType } from '@/components/modals/GemActionModals';

/** Manages which gem action modal is open. */
export function useGemModals() {
  const [state, setState] = useState<GemModalState | null>(null);
  const open = useCallback((type: GemModalType, gem: DecoratedGem) => setState({ type, gem }), []);
  const close = useCallback(() => setState(null), []);
  return { state, open, close };
}
