import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
}

const base =
  'dc-btn-anim inline-flex items-center justify-center gap-2 rounded-[4px] font-medium ' +
  'select-none whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none';

/*
 * Primary is a flat platinum fill on ink rather than a coloured gradient: the
 * chrome stays achromatic so the gemstones carry the only saturated colour.
 */
const variants: Record<ButtonVariant, string> = {
  primary: 'bg-btn-primary text-[var(--dc-button-ink)] border border-transparent',
  secondary:
    'bg-white/[0.035] text-ink border border-white/[0.12] hover:border-white/[0.22] hover:bg-white/[0.055]',
  ghost:
    'bg-transparent text-ink-faint border border-white/[0.08] hover:border-white/[0.16] hover:text-ink',
  danger: 'bg-btn-danger text-white border border-transparent',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-[12.5px]',
  md: 'h-11 px-5 text-[13.5px]',
  lg: 'h-12 px-6 text-[14px]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', block, className, ...rest }, ref) => (
    <button
      ref={ref}
      className={cn(base, variants[variant], sizes[size], block && 'w-full', className)}
      {...rest}
    />
  ),
);
Button.displayName = 'Button';
