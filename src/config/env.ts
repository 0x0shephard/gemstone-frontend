import { z } from 'zod';

/**
 * Absolute-URL check that works on browsers this app still supports.
 *
 * `URL.canParse` needs Chrome 120 / Safari 17 / Firefox 115, all from late 2023,
 * while the build targets Safari 16 — and transpilation rewrites syntax, never
 * polyfills APIs. On an older browser it was `undefined`, and because this
 * module is evaluated on import by nearly the whole app, the `TypeError` fired
 * before React mounted. The `Sentry.ErrorBoundary` in `App.tsx` cannot catch
 * that, so the page rendered blank with nothing in the DOM and no report.
 */
function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

const optionalUrl = z
  .string()
  .trim()
  .refine((value) => value === '' || isAbsoluteUrl(value), 'Must be an absolute URL');

const supabaseUrl = z
  .string()
  .trim()
  .refine(
    (value) => value === '' || /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(value),
    'Must use the project API URL: https://<project-ref>.supabase.co',
  );

const schema = z.object({
  VITE_DATA_MODE: z.enum(['mock', 'chain']).default('mock'),
  VITE_CHAIN_ID: z.coerce.number().int().positive().default(11155111),
  VITE_DEPLOYMENT_BLOCK: z.coerce.bigint().nonnegative().optional(),
  VITE_RPC_URL: optionalUrl.default(''),
  VITE_RPC_FALLBACK_URL: optionalUrl.default(''),
  VITE_EXPLORER_BASE_URL: optionalUrl.default('https://sepolia.etherscan.io'),
  VITE_IPFS_GATEWAY: optionalUrl.default('https://ipfs.io/ipfs/'),
  VITE_WALLETCONNECT_PROJECT_ID: z.string().trim().default(''),
  VITE_SUPABASE_URL: supabaseUrl.default(''),
  VITE_SUPABASE_ANON_KEY: z.string().trim().default(''),
  VITE_SUMSUB_BACKEND_URL: optionalUrl.default(''),
  VITE_SENTRY_DSN: z.string().trim().default(''),
  VITE_POSTHOG_KEY: z.string().trim().default(''),
  VITE_POSTHOG_HOST: optionalUrl.default('https://us.i.posthog.com'),
});

const parsed = schema.safeParse(import.meta.env);

export const environmentErrors = parsed.success
  ? []
  : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);

const values = parsed.success ? parsed.data : schema.parse({});

export const env = {
  dataMode: values.VITE_DATA_MODE,
  chainId: values.VITE_CHAIN_ID,
  deploymentBlock: values.VITE_DEPLOYMENT_BLOCK,
  rpcUrl: values.VITE_RPC_URL,
  rpcFallbackUrl: values.VITE_RPC_FALLBACK_URL,
  explorerBaseUrl: values.VITE_EXPLORER_BASE_URL,
  ipfsGateway: values.VITE_IPFS_GATEWAY,
  walletConnectProjectId: values.VITE_WALLETCONNECT_PROJECT_ID,
  supabaseUrl: values.VITE_SUPABASE_URL,
  supabaseAnonKey: values.VITE_SUPABASE_ANON_KEY,
  sumsubBackendUrl: values.VITE_SUMSUB_BACKEND_URL,
  sentryDsn: values.VITE_SENTRY_DSN,
  posthogKey: values.VITE_POSTHOG_KEY,
  posthogHost: values.VITE_POSTHOG_HOST,
} as const;

export const isConfigured = (value: string): boolean => value.length > 0;
export const authConfigured = isConfigured(env.supabaseUrl) && isConfigured(env.supabaseAnonKey);
export const walletConnectConfigured = isConfigured(env.walletConnectProjectId);
