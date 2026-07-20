/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // surfaces
        vault: '#08080A',
        card: '#0F0F13',
        panel: '#0D0D11',
        inset: '#0B0B0E',
        nested: '#0C0C10',
        sidebar: '#0A0A0D',
        track: '#1A1A20',
        // text
        ink: {
          DEFAULT: '#F3F3F6',
          soft: '#D7D7DD',
          softer: '#C9C9D0',
          muted: '#8B8B94',
          dim: '#56565D',
          faint: '#B3B3BA',
        },
        // gem accents
        ruby: '#E5484D',
        sapphire: '#5B8DEF',
        emerald: '#35B98A',
        amber: '#E5A23C',
      },
      fontFamily: {
        sans: ['Manrope', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.03em',
        eyebrow: '0.18em',
      },
      maxWidth: {
        content: '1200px',
      },
      backgroundImage: {
        'btn-primary': 'linear-gradient(180deg,#F1F1F4,#BCBCC4)',
        'btn-primary-tab': 'linear-gradient(180deg,#F1F1F4,#C6C6CD)',
        'btn-danger': 'linear-gradient(180deg,#E5484D,#B8383C)',
        'bar-funded': 'linear-gradient(90deg,#2F9D72,#35B98A)',
        'bar-short': 'linear-gradient(90deg,#E5A23C,#F0C479)',
      },
      keyframes: {
        dcfade: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'none' },
        },
        dcrise: {
          from: { opacity: '0', transform: 'translateY(20px)' },
          to: { opacity: '1', transform: 'none' },
        },
        dcmodal: {
          from: { opacity: '0', transform: 'translateY(16px) scale(.98)' },
          to: { opacity: '1', transform: 'none' },
        },
        dcpulse: {
          '0%,100%': { opacity: '.5' },
          '50%': { opacity: '1' },
        },
        dcfloat: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
      animation: {
        dcfade: 'dcfade .35s cubic-bezier(.22,.61,.36,1)',
        dcrise: 'dcrise .7s cubic-bezier(.22,.61,.36,1)',
        dcmodal: 'dcmodal .3s cubic-bezier(.22,.61,.36,1)',
        dcpulse: 'dcpulse 2s infinite',
        dcfloat: 'dcfloat 6s ease-in-out infinite',
      },
      boxShadow: {
        lift: '0 18px 40px rgba(0,0,0,.4)',
      },
    },
  },
  plugins: [],
};
