import { useState } from 'react';
import { cn } from '@/lib/cn';

type ColorScheme = 'atelier' | 'garnet';

const STORAGE_KEY = 'digital-carat-color-scheme';

function currentScheme(): ColorScheme {
  return document.documentElement.dataset.colorScheme === 'garnet' ? 'garnet' : 'atelier';
}

function applyScheme(scheme: ColorScheme) {
  document.documentElement.dataset.colorScheme = scheme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', scheme === 'atelier' ? '#F8F5F0' : '#0A1524');
  try {
    localStorage.setItem(STORAGE_KEY, scheme);
  } catch {
    // The visual preference still applies when browser storage is unavailable.
  }
}

export function ColorSchemeToggle({ className }: { className?: string }) {
  const [scheme, setScheme] = useState<ColorScheme>(currentScheme);
  const next = scheme === 'atelier' ? 'garnet' : 'atelier';
  const nextLabel = next === 'atelier' ? 'Ivory' : 'Midnight navy';

  return (
    <button
      type="button"
      className={cn(
        'group relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-[4px] border border-line/[0.11] bg-line/[0.035] transition-colors hover:border-line/[0.22] hover:bg-line/[0.06]',
        className,
      )}
      aria-label={`Switch to ${nextLabel} color scheme`}
      onClick={() => {
        applyScheme(next);
        setScheme(next);
      }}
    >
      <span
        aria-hidden="true"
        className="h-[17px] w-[17px] rotate-45 rounded-[4px] border border-line/35 bg-atelier shadow-[0_0_14px_rgb(var(--dc-accent-rgb)/.28)] transition-transform duration-300 group-hover:rotate-[135deg]"
      />
      <span
        aria-hidden="true"
        className="absolute bottom-[8px] right-[8px] h-2 w-2 rounded-full border border-sidebar bg-amber"
      />
    </button>
  );
}
