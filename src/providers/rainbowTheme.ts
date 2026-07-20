import { darkTheme, type Theme } from '@rainbow-me/rainbowkit';

/** RainbowKit modal themed to the Digital Carat vault palette. */
export const rainbowTheme: Theme = darkTheme({
  accentColor: '#F1F1F4',
  accentColorForeground: '#0A0A0C',
  borderRadius: 'medium',
  fontStack: 'system',
  overlayBlur: 'small',
});

// Nudge a few surfaces toward the graphite look.
rainbowTheme.colors.modalBackground = '#0F0F13';
rainbowTheme.colors.modalBorder = 'rgba(255,255,255,0.08)';
rainbowTheme.colors.profileForeground = '#0D0D11';
rainbowTheme.fonts.body = "'Manrope', system-ui, sans-serif";
