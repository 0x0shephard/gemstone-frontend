import { useEffect, useMemo, useRef, useState } from 'react';
import type { DecoratedGem } from '@/services/types';
import { cn } from '@/lib/cn';

const IMAGE_GATEWAY_TIMEOUT_MS = 8_000;

interface GemThumbProps {
  gem: DecoratedGem;
  /** CSS height; width fills container. */
  height?: number | string;
  rounded?: string;
  showTag?: boolean;
  showCarat?: boolean;
  children?: React.ReactNode;
  className?: string;
}

/** The faux-faceted gem swatch, with optional type tag + carat chip overlays. */
export function GemThumb({
  gem,
  height = 176,
  rounded = 'rounded-[4px]',
  showTag = true,
  showCarat = true,
  children,
  className,
}: GemThumbProps) {
  const candidates = useMemo(
    () => [...new Set([...(gem.imageCandidates ?? []), ...(gem.image ? [gem.image] : [])])],
    [gem.image, gem.imageCandidates],
  );
  const candidateKey = candidates.join('|');
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [loadedImage, setLoadedImage] = useState<string>();
  const [nearViewport, setNearViewport] = useState(
    () => typeof window === 'undefined' || !('IntersectionObserver' in window),
  );
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (nearViewport || !host.current || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setNearViewport(true);
        observer.disconnect();
      },
      { rootMargin: '240px' },
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [nearViewport]);

  // A card can be reused for another gem as filtered lists change. Start the
  // new immutable image at its preferred gateway rather than carrying the old
  // card's exhausted index across tokens.
  useEffect(() => {
    setCandidateIndex(0);
    setLoadedImage(undefined);
  }, [candidateKey]);

  const image = candidates[candidateIndex];

  // Some mobile gateways leave a request pending indefinitely instead of
  // failing it. Treat a stalled gateway like an error so the next immutable
  // source gets a chance to render.
  useEffect(() => {
    if (!nearViewport || !image || loadedImage === image) return;
    const timeout = window.setTimeout(() => {
      setCandidateIndex((current) => (current === candidateIndex ? current + 1 : current));
    }, IMAGE_GATEWAY_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [candidateIndex, image, loadedImage, nearViewport]);

  return (
    <div
      ref={host}
      className={cn('relative overflow-hidden', rounded, className)}
      style={{ height, background: gem.thumb }}
    >
      {nearViewport && image && (
        <img
          key={image}
          src={image}
          alt=""
          loading="eager"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          onLoad={() => setLoadedImage(image)}
          // One gateway failing is not evidence that the token has no image.
          // Advance through the immutable alternatives; only the final failure
          // exposes the generated faceted swatch underneath.
          onError={() => {
            setLoadedImage(undefined);
            setCandidateIndex((current) => (current === candidateIndex ? current + 1 : current));
          }}
        />
      )}
      <div
        aria-hidden
        className="absolute inset-0 opacity-60"
        style={{
          background:
            'radial-gradient(circle at 28% 12%, rgba(255,255,255,.12), transparent 26%), linear-gradient(150deg, transparent 45%, rgba(0,0,0,.28))',
        }}
      />
      {showTag && (
        <span
          className="absolute left-3 top-3 rounded-[4px] px-2 py-1 text-[11px] font-semibold"
          style={{
            color: gem.color,
            background: `${gem.color}1f`,
            border: `1px solid ${gem.color}55`,
          }}
        >
          {gem.typeLabel}
        </span>
      )}
      {showCarat && (
        <span className="absolute right-3 top-3 rounded-[4px] bg-black/40 px-2 py-1 font-mono text-[11px] text-ink-soft backdrop-blur">
          {gem.caratsFmt}
        </span>
      )}
      {children}
    </div>
  );
}
