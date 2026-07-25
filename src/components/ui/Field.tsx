import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export const inputClass =
  'h-11 w-full rounded-[11px] border border-white/[0.1] bg-inset px-3.5 text-[14px] text-ink ' +
  'outline-none transition-[border-color,box-shadow] placeholder:text-ink-dim focus:border-atelier/50 focus:ring-2 focus:ring-atelier/10';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(
  ({ label, error, className, id, ...rest }, ref) => (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{label}</span>
      )}
      <input ref={ref} id={id} className={cn(inputClass, error && 'border-ruby/60', className)} {...rest} />
      {error && <span className="mt-1 block text-[11.5px] text-ruby">{error}</span>}
    </label>
  ),
);
Field.displayName = 'Field';

/** "OR" divider used between auth methods. */
export function OrDivider() {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="h-px flex-1 bg-white/[0.08]" />
      <span className="text-[11px] uppercase tracking-[0.14em] text-ink-dim">or</span>
      <span className="h-px flex-1 bg-white/[0.08]" />
    </div>
  );
}
