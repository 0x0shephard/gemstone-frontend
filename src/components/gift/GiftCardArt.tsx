import { useMemo } from 'react';
import { qrMatrix } from '@/lib/qr';

export const GIFT_TEMPLATES = ['classic', 'noir', 'celebration'] as const;
export type GiftTemplate = (typeof GIFT_TEMPLATES)[number];

export const CARD_WIDTH = 1050;
export const CARD_HEIGHT = 640;

interface Palette {
  label: string;
  background: string;
  panel: string;
  ink: string;
  inkMuted: string;
  accent: string;
  rule: string;
}

const PALETTES: Record<GiftTemplate, Palette> = {
  classic: {
    label: 'Classic',
    background: '#FAF7F1',
    panel: '#EFE9DD',
    ink: '#14161A',
    inkMuted: '#6B6455',
    accent: '#8A7550',
    rule: '#DCD3C2',
  },
  noir: {
    label: 'Noir',
    background: '#0B0C0E',
    panel: '#16181C',
    ink: '#F3F2EF',
    inkMuted: '#9A9890',
    accent: '#C9B27A',
    rule: '#26282D',
  },
  celebration: {
    label: 'Celebration',
    background: '#0E1F1A',
    panel: '#173029',
    ink: '#F2F6F3',
    inkMuted: '#9DB4AA',
    accent: '#D8B36B',
    rule: '#22463C',
  },
};

/*
 * The card is rasterised for PNG export by loading its own markup into an
 * `Image`, and a detached SVG cannot reach the page's `@font-face` rules. Both
 * stacks therefore end in a generic family that every system resolves, so an
 * export falls back to a reasonable face rather than to whatever the renderer
 * picks when a family is missing entirely.
 */
const DISPLAY_FONT = "'Manrope', 'Avenir Next', 'Segoe UI', sans-serif";
const MONO_FONT = "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace";

export interface GiftCardArtProps {
  template: GiftTemplate;
  gemName: string;
  displayId: string;
  variety: string;
  caratsFmt: string;
  custody: string;
  valueFmt: string;
  recipientName?: string;
  senderName?: string;
  message?: string;
  /** Grouped claim code, printed under the QR for when scanning fails. */
  displayCode: string;
  claimUrl: string;
  expiresLabel: string;
  /**
   * Gem photograph, as a data URI. A remote URL renders on screen but taints
   * the export canvas, so the composer inlines it first and passes nothing when
   * that is not possible.
   */
  imageHref?: string;
}

/** Greedy wrap by character budget — SVG has no text flow of its own. */
function wrap(text: string, perLine: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= perLine) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && text.length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.,;:]$/, '')}…`;
  }
  return lines;
}

/**
 * The printable card itself, as self-contained SVG.
 *
 * Everything the recipient needs is on the face of it: what the stone is, who
 * sent it, and two independent ways to reach the claim page — the QR, and the
 * code in plain characters underneath for when a phone camera will not
 * cooperate with a folded piece of card.
 */
export function GiftCardArt(props: GiftCardArtProps) {
  const palette = PALETTES[props.template];
  const qr = useMemo(() => qrMatrix(props.claimUrl), [props.claimUrl]);

  const messageLines = props.message ? wrap(props.message, 46, 3) : [];
  const attributes: [string, string][] = [
    ['Variety', props.variety],
    ['Carat', props.caratsFmt],
    ['Custody', props.custody],
    ['Approved value', props.valueFmt],
  ];

  // The symbol is drawn in module units and scaled by the group transform, so
  // the quiet zone stays a true four modules at any printed size.
  const quiet = 4;
  const qrExtent = qr.modules + quiet * 2;
  const qrSize = 172;
  const qrX = 596 + (410 - qrSize) / 2;
  const qrY = 292;

  return (
    <svg
      viewBox={`0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`}
      width="100%"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Digital Carat gift card for ${props.gemName}`}
    >
      <defs>
        <clipPath id="gift-photo-clip">
          <rect x="44" y="118" width="474" height="300" rx="6" />
        </clipPath>
        <linearGradient id="gift-facet" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={palette.accent} stopOpacity="0.32" />
          <stop offset="100%" stopColor={palette.accent} stopOpacity="0.06" />
        </linearGradient>
      </defs>

      <rect width={CARD_WIDTH} height={CARD_HEIGHT} fill={palette.background} />
      <rect
        x="16"
        y="16"
        width={CARD_WIDTH - 32}
        height={CARD_HEIGHT - 32}
        rx="4"
        fill="none"
        stroke={palette.accent}
        strokeOpacity="0.45"
      />

      {/* Masthead */}
      <text
        x="44"
        y="72"
        fill={palette.ink}
        fontFamily={DISPLAY_FONT}
        fontSize="21"
        fontWeight="600"
        letterSpacing="6"
      >
        DIGITAL CARAT
      </text>
      <text
        x={CARD_WIDTH - 44}
        y="72"
        textAnchor="end"
        fill={palette.accent}
        fontFamily={DISPLAY_FONT}
        fontSize="12"
        fontWeight="600"
        letterSpacing="4.5"
      >
        GIFT CARD
      </text>
      <line x1="44" y1="94" x2={CARD_WIDTH - 44} y2="94" stroke={palette.rule} />

      {/* Left: the stone */}
      <rect x="44" y="118" width="474" height="300" rx="6" fill={palette.panel} />
      {props.imageHref ? (
        <image
          href={props.imageHref}
          x="44"
          y="118"
          width="474"
          height="300"
          preserveAspectRatio="xMidYMid slice"
          clipPath="url(#gift-photo-clip)"
        />
      ) : (
        <g clipPath="url(#gift-photo-clip)">
          <rect x="44" y="118" width="474" height="300" fill="url(#gift-facet)" />
          <path
            d="M281 188 L343 244 L281 348 L219 244 Z M219 244 L343 244 M281 188 L281 348"
            fill="none"
            stroke={palette.accent}
            strokeOpacity="0.55"
            strokeWidth="1.5"
          />
        </g>
      )}

      <text
        x="44"
        y="462"
        fill={palette.ink}
        fontFamily={DISPLAY_FONT}
        fontSize="30"
        fontWeight="600"
        letterSpacing="-0.8"
      >
        {props.gemName}
      </text>
      <text x="44" y="488" fill={palette.inkMuted} fontFamily={MONO_FONT} fontSize="13">
        {props.displayId}
      </text>

      {attributes.map(([label, value], index) => {
        const y = 528 + index * 26;
        return (
          <g key={label}>
            <text
              x="44"
              y={y}
              fill={palette.inkMuted}
              fontFamily={DISPLAY_FONT}
              fontSize="11"
              letterSpacing="1.6"
            >
              {label.toUpperCase()}
            </text>
            <text
              x="518"
              y={y}
              textAnchor="end"
              fill={palette.ink}
              fontFamily={MONO_FONT}
              fontSize="13"
            >
              {value}
            </text>
          </g>
        );
      })}

      {/* Right: dedication and claim */}
      <line x1="558" y1="118" x2="558" y2={CARD_HEIGHT - 44} stroke={palette.rule} />

      <text
        x="596"
        y="146"
        fill={palette.inkMuted}
        fontFamily={DISPLAY_FONT}
        fontSize="11"
        letterSpacing="2.2"
      >
        PRESENTED TO
      </text>
      <text
        x="596"
        y="182"
        fill={palette.ink}
        fontFamily={DISPLAY_FONT}
        fontSize="27"
        fontWeight="600"
        letterSpacing="-0.5"
      >
        {props.recipientName || 'You'}
      </text>

      {messageLines.map((line, index) => (
        <text
          key={index}
          x="596"
          y={216 + index * 22}
          fill={palette.inkMuted}
          fontFamily={DISPLAY_FONT}
          fontSize="14.5"
        >
          {line}
        </text>
      ))}

      {props.senderName && (
        <text
          x="596"
          y={224 + Math.max(messageLines.length, 1) * 22}
          fill={palette.accent}
          fontFamily={DISPLAY_FONT}
          fontSize="13"
          fontStyle="italic"
        >
          — {props.senderName}
        </text>
      )}

      {/*
        Always a white field with a dark symbol, whichever palette is in use.
        Scanners cope poorly with inverted codes and a dark card is exactly when
        someone is standing in bad light trying to read it.
      */}
      <rect
        x={qrX - 14}
        y={qrY - 14}
        width={qrSize + 28}
        height={qrSize + 28}
        rx="4"
        fill="#FFFFFF"
      />
      <g transform={`translate(${qrX} ${qrY}) scale(${qrSize / qrExtent})`}>
        <path d={qr.path} transform={`translate(${quiet} ${quiet})`} fill="#000000" />
      </g>

      <text
        x={qrX + qrSize / 2}
        y={qrY + qrSize + 48}
        textAnchor="middle"
        fill={palette.ink}
        fontFamily={DISPLAY_FONT}
        fontSize="14"
        fontWeight="600"
      >
        Scan to retrieve your token
      </text>
      <text
        x={qrX + qrSize / 2}
        y={qrY + qrSize + 76}
        textAnchor="middle"
        fill={palette.accent}
        fontFamily={MONO_FONT}
        fontSize="17"
        letterSpacing="2.4"
      >
        {props.displayCode}
      </text>
      <text
        x={qrX + qrSize / 2}
        y={qrY + qrSize + 98}
        textAnchor="middle"
        fill={palette.inkMuted}
        fontFamily={DISPLAY_FONT}
        fontSize="11"
      >
        {props.expiresLabel}
      </text>
    </svg>
  );
}

export function templateLabel(template: GiftTemplate): string {
  return PALETTES[template].label;
}
