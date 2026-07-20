import type { DecoratedGem } from '@/services/types';
import {
  BidModal,
  BuyModal,
  FundReserveModal,
  OfferModal,
  ListModal,
  SwapModal,
  RedeemModal,
} from './index';

export type GemModalType =
  | 'bid'
  | 'buyNow'
  | 'buy'
  | 'reserve'
  | 'offer'
  | 'list'
  | 'swap'
  | 'redeem';

export interface GemModalState {
  type: GemModalType;
  gem: DecoratedGem;
}

/** Renders the correct action modal for the current selection. */
export function GemActionModals({
  state,
  onClose,
}: {
  state: GemModalState | null;
  onClose: () => void;
}) {
  if (!state) return null;
  const { type, gem } = state;
  const open = true;
  switch (type) {
    case 'bid':
      return <BidModal gem={gem} open={open} onClose={onClose} />;
    case 'buyNow':
      return <BuyModal gem={gem} open={open} onClose={onClose} mode="buyNow" />;
    case 'buy':
      return <BuyModal gem={gem} open={open} onClose={onClose} mode="buy" />;
    case 'reserve':
      return <FundReserveModal gem={gem} open={open} onClose={onClose} />;
    case 'offer':
      return <OfferModal gem={gem} open={open} onClose={onClose} />;
    case 'list':
      return <ListModal gem={gem} open={open} onClose={onClose} />;
    case 'swap':
      return <SwapModal gem={gem} open={open} onClose={onClose} />;
    case 'redeem':
      return <RedeemModal gem={gem} open={open} onClose={onClose} />;
    default:
      return null;
  }
}
