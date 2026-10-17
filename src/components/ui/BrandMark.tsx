import { cn } from '@/lib/cn';

/*
 * The Digital Carat logo: an emerald-cut gem in outline, threaded on a vertical
 * line with a small diamond above and below, inside a circle over the DIGITAL /
 * CARAT wordmark. Coordinates are centred on the gem; the gem is 212 wide and
 * 326 tall, as in the supplied artwork.
 */
const OUTER = '-63,-163 63,-163 106,-120 106,120 63,163 -63,163 -106,120 -106,-120';
const STEP = '-48,-136 48,-136 80,-104 80,104 48,136 -48,136 -80,104 -80,-104';
const TABLE = '-30,-100 30,-100 50,-80 50,80 30,100 -30,100 -50,80 -50,-80';
const pairs = (points: string) => points.split(' ').map((point) => point.split(',').map(Number));
/** Corner facets: each outer vertex runs to the matching corner of the table. */
const FACETS = pairs(OUTER).map(([x1, y1], index) => {
  const [x2, y2] = pairs(TABLE)[index];
  return `M${x1} ${y1}L${x2} ${y2}`;
});
const STEM = 'M0 -330V-259M0 -225V-163M0 163V216M0 250V302';
const DIAMONDS = ['0,-259 17,-242 0,-225 -17,-242', '0,216 17,233 0,250 -17,233'];

/**
 * Gem, facets and stem, drawn with a hairline that stays crisp at any size.
 * `simplified` drops the stepped ring and corner facets, which crowd into a
 * blot below about 40px tall; the outline, table and stem still read.
 */
function GemGlyph({
  strokeWidth,
  simplified = false,
}: {
  strokeWidth: number;
  simplified?: boolean;
}) {
  const line = {
    stroke: 'currentColor',
    strokeWidth,
    vectorEffect: 'non-scaling-stroke' as const,
    strokeLinejoin: 'miter' as const,
  };
  return (
    <g fill="none">
      <path d={STEM} {...line} />
      {DIAMONDS.map((points) => (
        <polygon key={points} points={points} {...line} />
      ))}
      <polygon points={OUTER} {...line} />
      {!simplified && <polygon points={STEP} {...line} />}
      <polygon points={TABLE} {...line} />
      {!simplified && <path d={FACETS.join('')} {...line} />}
    </g>
  );
}

interface BrandMarkProps {
  /** Height of the gem glyph in px; the stem makes it about three times taller than wide. */
  size?: number;
  withWordmark?: boolean;
  className?: string;
}

/** The compact mark (gem on its stem), optionally with the DIGITAL CARAT wordmark. */
export function BrandMark({ size = 20, withWordmark = true, className }: BrandMarkProps) {
  const height = Math.round(size * 1.6);
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg
        aria-hidden
        viewBox="-112 -336 224 644"
        style={{ height, width: (height * 224) / 644 }}
        className="shrink-0 text-brand"
      >
        <GemGlyph strokeWidth={size >= 24 ? 1.3 : 1.1} simplified={height < 40} />
      </svg>
      {withWordmark && (
        <span className="font-brand text-[15px] font-medium uppercase leading-none tracking-[0.24em] text-brand">
          Digital Carat
        </span>
      )}
    </span>
  );
}

/** The full circular logo with the stacked wordmark, for larger placements. */
export function BrandLogo({ size = 160, className }: { size?: number; className?: string }) {
  return (
    <svg
      role="img"
      aria-label="Digital Carat"
      viewBox="-540 -440 1080 1080"
      style={{ width: size, height: size }}
      className={cn('shrink-0 text-brand', className)}
    >
      <circle
        cx="0"
        cy="100"
        r="527"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        vectorEffect="non-scaling-stroke"
      />
      <GemGlyph strokeWidth={1.2} />
      <g
        fill="currentColor"
        textAnchor="middle"
        style={{ fontFamily: "'Cormorant Garamond', 'Times New Roman', serif" }}
        fontSize="78"
        fontWeight={500}
        letterSpacing="22"
      >
        <text x="11" y="385">
          DIGITAL
        </text>
        <text x="11" y="475">
          CARAT
        </text>
      </g>
    </svg>
  );
}
