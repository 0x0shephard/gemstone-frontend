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
  'dc-btn-anim inline-flex items-center justify-center gap-2 rounded-[11px] font-semibold ' +
  'select-none whitespace-nowrap disabled:opacity-45 disabled:pointer-events-none';

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-btn-primary text-[var(--dc-button-ink)] border border-white/20 shadow-[0_8px_24px_rgba(0,0,0,.24)]',
  secondary:
    'bg-white/[0.045] text-ink border border-white/[0.14] hover:border-white/25 hover:bg-white/[0.065]',
  ghost: 'bg-transparent text-ink-faint border border-white/[0.08] hover:border-white/[0.15] hover:text-ink',
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
