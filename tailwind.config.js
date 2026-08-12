/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // surfaces
        vault: 'var(--dc-vault)',
        card: 'var(--dc-card)',
        panel: 'var(--dc-panel)',
        inset: 'var(--dc-sidebar)',
        nested: 'color-mix(in srgb, var(--dc-card) 72%, var(--dc-vault))',
        sidebar: 'rgb(var(--dc-sidebar-rgb) / <alpha-value>)',
        elevated: 'var(--dc-elevated)',
        track: 'var(--dc-track)',
        // text
        ink: {
          DEFAULT: 'var(--dc-ink)',
          soft: 'var(--dc-ink-soft)',
          softer: 'var(--dc-ink-softer)',
          muted: 'var(--dc-ink-muted)',
          dim: 'var(--dc-ink-dim)',
          faint: 'var(--dc-ink-faint)',
        },
        /*
         * Hairlines, dividers and inset washes. Written as `border-line/[0.08]`
         * so the contrast direction flips with the scheme: charcoal-on-ivory in
         * the light theme, ivory-on-navy in the dark one.
         */
        line: 'rgb(var(--dc-line-rgb) / <alpha-value>)',
        // brand + gem accents
        atelier: 'rgb(var(--dc-accent-rgb) / <alpha-value>)',
        ruby: 'rgb(var(--dc-ruby-rgb) / <alpha-value>)',
        sapphire: 'rgb(var(--dc-sapphire-rgb) / <alpha-value>)',
        emerald: 'rgb(var(--dc-emerald-rgb) / <alpha-value>)',
        amber: 'rgb(var(--dc-amber-rgb) / <alpha-value>)',
      },
      // Manrope carries both display and body: hierarchy comes from its weight
      // range (300–800) rather than a second face. Mono stays JetBrains for
      // addresses, hashes and figures, which need tabular monospace.
      fontFamily: {
        display: ['Manrope', 'system-ui', 'sans-serif'],
        sans: ['Manrope', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.03em',
        eyebrow: '0.18em',
      },
      maxWidth: {
        content: '1360px',
      },
      backgroundImage: {
        'btn-primary': 'linear-gradient(180deg,var(--dc-button-top),var(--dc-button-bottom))',
        'btn-primary-tab': 'linear-gradient(180deg,var(--dc-button-top),var(--dc-button-bottom))',
        'btn-danger': 'linear-gradient(180deg,#8A2B4C,#6D213C)',
        'bar-funded': 'linear-gradient(90deg,#0B5D4B,#12836A)',
        'bar-short': 'linear-gradient(90deg,#C9A227,#DDB944)',
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
          from: { opacity: '0', transform: 'translateY(12px) scale(.985)' },
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
        dcslideup: {
          from: { opacity: '0', transform: 'translateY(100%)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        dcdrawer: {
          from: { opacity: '0', transform: 'translateX(-100%)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        dcfade: 'dcfade .35s cubic-bezier(.22,.61,.36,1)',
        dcrise: 'dcrise .7s cubic-bezier(.22,.61,.36,1)',
        dcmodal: 'dcmodal .3s cubic-bezier(.22,.61,.36,1)',
        dcpulse: 'dcpulse 2s infinite',
        dcfloat: 'dcfloat 6s ease-in-out infinite',
        dcslideup: 'dcslideup .28s cubic-bezier(.22,.61,.36,1)',
        dcdrawer: 'dcdrawer .28s cubic-bezier(.22,.61,.36,1)',
      },
      boxShadow: {
        lift: 'var(--dc-lift-shadow)',
      },
    },
  },
  plugins: [],
};
