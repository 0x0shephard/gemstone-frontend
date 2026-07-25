import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: number;
}

/** Centered overlay dialog matching the mockup modal treatment. */
export function Modal({ open, onClose, title, subtitle, children, footer, maxWidth = 480 }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(3,4,6,.78)', backdropFilter: 'blur(10px)' }}
      onClick={onClose}
      role="dialog"
      aria-modal
    >
      <div
        className={cn(
          'dc-facet-border relative max-h-[calc(100vh-2rem)] w-full animate-dcmodal overflow-y-auto rounded-[22px] border border-white/[0.12] bg-elevated p-5 shadow-[0_30px_100px_rgba(0,0,0,.65)] sm:p-6',
        )}
        style={{ maxWidth }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.09] text-[18px] text-ink-muted transition-colors hover:border-white/[0.18] hover:text-ink"
        >
          ×
        </button>
        {(title || subtitle) && (
          <div className="mb-5 pr-10">
            <div className="mb-2 h-px w-8 bg-atelier" />
            {title && <h2 className="font-display text-[20px] font-medium tracking-[-0.02em] text-ink">{title}</h2>}
            {subtitle && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">{subtitle}</p>}
          </div>
        )}
        <div className="space-y-4">{children}</div>
        {footer && <div className="mt-5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
