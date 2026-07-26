import type { ReactNode } from 'react';
import { env, environmentErrors } from '@/config/env';
import { deploymentErrors } from '@/config/contracts';
import { BrandMark } from '@/components/ui/BrandMark';

export function ConfigurationGate({ children }: { children: ReactNode }) {
  const errors = env.dataMode === 'chain' ? deploymentErrors : environmentErrors;
  if (errors.length === 0) return children;

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-5 text-ink">
      <section
        className="w-full max-w-2xl rounded-[4px] border border-ruby/30 bg-panel p-7"
        role="alert"
        aria-labelledby="configuration-title"
      >
        <BrandMark />
        <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.16em] text-ruby">
          Chain mode unavailable
        </p>
        <h1 id="configuration-title" className="mt-2 text-[24px] font-bold">
          Deployment configuration is incomplete
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          Digital Carat will not substitute demo data while chain mode is selected. Configure every
          field below, then rebuild the deployment.
        </p>
        <ul className="mt-5 space-y-2 rounded-[4px] border border-white/[0.08] bg-canvas p-4 font-mono text-[12px] text-ink-soft">
          {errors.map((error) => (
            <li key={error}>• {error}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
