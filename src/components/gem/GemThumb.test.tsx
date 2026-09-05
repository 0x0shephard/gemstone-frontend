import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GemThumb } from './GemThumb';
import type { DecoratedGem } from '@/services/types';

const gem = {
  image: 'https://slow.example/ipfs/image',
  imageCandidates: ['https://slow.example/ipfs/image', 'https://healthy.example/ipfs/image'],
  thumb: 'rgb(1, 2, 3)',
  color: '#fff',
  typeLabel: 'Ruby',
  caratsFmt: '1 ct',
} as DecoratedGem;

describe('GemThumb', () => {
  afterEach(() => vi.useRealTimers());

  it('tries the next immutable gateway when the preferred image fails', () => {
    const { container } = render(<GemThumb gem={gem} />);
    const image = container.querySelector('img')!;

    expect(image).toHaveAttribute('src', 'https://slow.example/ipfs/image');
    fireEvent.error(image);
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://healthy.example/ipfs/image',
    );
  });

  it('falls back to the generated gem swatch only after every gateway fails', () => {
    const { container } = render(<GemThumb gem={gem} />);
    const image = container.querySelector('img')!;

    fireEvent.error(image);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  it('moves past a gateway that stays pending on mobile', () => {
    vi.useFakeTimers();
    const { container } = render(<GemThumb gem={gem} />);
    expect(container.querySelector('img')).toHaveAttribute('src', gem.imageCandidates?.[0]);

    act(() => vi.advanceTimersByTime(8_000));

    expect(container.querySelector('img')).toHaveAttribute('src', gem.imageCandidates?.[1]);
  });
});
