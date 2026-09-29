export default async function globalSetup() {
  if (process.env.E2E_REUSE_STACK === '1') return;
  const { up } = await import('./stack.mjs');
  await up();
}
