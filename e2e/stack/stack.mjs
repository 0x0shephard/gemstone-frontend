#!/usr/bin/env node
/**
 * Local full-stack environment for the end-to-end suite.
 *
 *   node e2e/stack/stack.mjs up     start anvil + local Supabase, deploy, seed
 *   node e2e/stack/stack.mjs down   stop both
 *
 * Everything is local and disposable: a fresh anvil chain (Sepolia's chain id,
 * so the app and edge functions need no test branches), a fresh protocol
 * deployment from ../gemstone, and a Supabase project built from the real
 * migrations. Output lands in e2e/.stack/ and .env.e2e.local, both ignored.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { mnemonicToAccount } from 'viem/accounts';
import { bytesToHex } from 'viem';

const root = path.resolve(import.meta.dirname, '../..');
const contractsDir = path.resolve(root, process.env.CONTRACTS_DIR ?? '../gemstone');
const stackDir = path.join(root, 'e2e/.stack');
const supabaseWorkdir = path.join(stackDir, 'supabase-workdir');
const RPC = 'http://127.0.0.1:8545';
const DOCKER_RPC = 'http://host.docker.internal:8545';
const MAIL_CAPTURE = 'http://host.docker.internal:4010/emails';
const SITE = 'http://127.0.0.1:4174';
const MNEMONIC = 'test test test test test test test test test test test junk';

/** Anvil's public development accounts. Local chain only. */
const roles = ['admin', 'operator', 'custodian', 'seller', 'alice', 'bob'];
export const accounts = Object.fromEntries(
  roles.map((role, index) => {
    const account = mnemonicToAccount(MNEMONIC, { addressIndex: index });
    return [role, { address: account.address, key: bytesToHex(account.getHdKey().privateKey) }];
  }),
);

function log(message) {
  console.log(`[e2e-stack] ${message}`);
}

async function rpc(method, params = []) {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

async function waitFor(check, label, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (await check()) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become ready`);
}

async function startChain() {
  const running = await rpc('eth_chainId').catch(() => null);
  if (running) {
    if (running !== '0xaa36a7') throw new Error(`Port 8545 is a different chain (${running})`);
    // A fresh chain every run: deterministic addresses, no state from a previous run.
    await rpc('anvil_reset');
    log('reset anvil on :8545');
    return;
  }
  // Docker on Linux reaches the host through host-gateway, not loopback, so CI
  // listens on every interface. A developer machine keeps the chain on 127.0.0.1.
  const host = process.env.CI ? '0.0.0.0' : '127.0.0.1';
  const child = spawn(
    'anvil',
    ['--chain-id', '11155111', '--port', '8545', '--host', host, '--silent'],
    {
      detached: true,
      stdio: 'ignore',
    },
  );
  child.unref();
  fs.writeFileSync(path.join(stackDir, 'anvil.pid'), String(child.pid));
  await waitFor(async () => (await rpc('eth_chainId')) === '0xaa36a7', 'anvil');
  log('anvil started on :8545');
}

/**
 * viem batches reads through Multicall3 at its canonical address, which every
 * public chain has and a fresh anvil does not. The bytecode is identical on
 * every chain, so a vendored copy keeps the stack offline.
 */
async function installMulticall3() {
  const code = fs.readFileSync(path.join(root, 'e2e/stack/multicall3.bytecode'), 'utf8').trim();
  await rpc('anvil_setCode', ['0xcA11bde05977b3631167028862bE2a173976CA11', code]);
}

function deployProtocol() {
  log('deploying protocol');
  const output = execFileSync(
    'forge',
    ['script', 'script/DeployLocalE2E.s.sol:DeployLocalE2E', '--rpc-url', RPC, '--broadcast'],
    {
      cwd: contractsDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        PRIVATE_KEY: accounts.admin.key,
        GIFT_OPERATOR_ADDRESS: accounts.operator.address,
        E2E_CUSTODIAN_KEY: accounts.custodian.key,
        E2E_SELLER: accounts.seller.address,
        E2E_ALICE_KEY: accounts.alice.key,
        E2E_BOB_KEY: accounts.bob.key,
        EXPECTED_CHAIN_ID: '11155111',
      },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const line = output.split('\n').find((row) => row.includes('E2E_DEPLOYMENT'));
  if (!line) throw new Error(`Deployment output missing:\n${output.slice(-2000)}`);
  // Local broadcasts are not deployment records; keep the contracts repo clean.
  fs.rmSync(path.join(contractsDir, 'broadcast/DeployLocalE2E.s.sol'), {
    recursive: true,
    force: true,
  });
  fs.rmSync(path.join(contractsDir, 'cache/DeployLocalE2E.s.sol'), {
    recursive: true,
    force: true,
  });
  return JSON.parse(line.slice(line.indexOf('{')));
}

function supabase(args, options = {}) {
  return execFileSync('npx', ['supabase', ...args, '--workdir', supabaseWorkdir], {
    cwd: root,
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function prepareSupabaseWorkdir() {
  const target = path.join(supabaseWorkdir, 'supabase');
  fs.rmSync(path.join(target, 'migrations'), { recursive: true, force: true });
  fs.mkdirSync(path.join(target, 'migrations'), { recursive: true });
  const config = fs
    .readFileSync(path.join(root, 'supabase/config.toml'), 'utf8')
    .replace(/^project_id\s*=.*$/m, 'project_id = "digital-carat-e2e"');
  fs.writeFileSync(path.join(target, 'config.toml'), config);
  fs.copyFileSync(
    path.join(root, 'e2e/stack/baseline.sql'),
    path.join(target, 'migrations/202607240000_e2e_baseline.sql'),
  );
  for (const file of fs.readdirSync(path.join(root, 'supabase/migrations'))) {
    if (/^\d+_.+\.sql$/.test(file)) {
      fs.copyFileSync(
        path.join(root, 'supabase/migrations', file),
        path.join(target, 'migrations', file),
      );
    }
  }
  const functions = path.join(target, 'functions');
  if (!fs.existsSync(functions)) fs.symlinkSync(path.join(root, 'supabase/functions'), functions);
}

function startSupabase() {
  prepareSupabaseWorkdir();
  let running = false;
  try {
    supabase(['status', '-o', 'json']);
    running = true;
  } catch {
    /* not running yet */
  }
  if (running) {
    // A fresh database each run, so journeys never depend on a previous one.
    log('resetting local Supabase database');
    supabase(['db', 'reset'], { stdio: 'inherit' });
  } else {
    log('starting local Supabase (first run pulls images)');
    supabase(['start', '-x', 'studio,imgproxy,logflare,vector,supavisor,realtime'], {
      stdio: 'inherit',
    });
  }
  const status = JSON.parse(supabase(['status', '-o', 'json']));
  return {
    url: status.API_URL,
    anonKey: status.ANON_KEY,
    serviceKey: status.SERVICE_ROLE_KEY,
    mailUrl: status.INBUCKET_URL ?? status.MAILPIT_URL ?? null,
  };
}

async function rest(db, pathname, init = {}) {
  const response = await fetch(`${db.url}${pathname}`, {
    ...init,
    headers: {
      apikey: db.serviceKey,
      authorization: `Bearer ${db.serviceKey}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
      ...init.headers,
    },
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${init.method ?? 'GET'} ${pathname}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function seedDatabase(db) {
  log('seeding users, wallets and submissions');
  const users = {};
  for (const role of ['seller', 'alice', 'bob']) {
    const email = `${role}@e2e.digitalcarat.test`;
    const existing = await rest(db, `/auth/v1/admin/users?email=${encodeURIComponent(email)}`);
    const found = existing?.users?.find((user) => user.email === email);
    const user =
      found ??
      (await rest(db, '/auth/v1/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password: 'e2e-password-not-secret',
          email_confirm: true,
          user_metadata: { full_name: role[0].toUpperCase() + role.slice(1) },
        }),
      }));
    users[role] = { id: user.id, email, password: 'e2e-password-not-secret' };
    await rest(db, '/rest/v1/wallet_links?on_conflict=wallet_address', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        profile_id: user.id,
        wallet_address: accounts[role].address.toLowerCase(),
        chain_id: 11155111,
        is_primary: true,
        verified_at: new Date().toISOString(),
      }),
    });
  }

  // One registered submission per on-chain gem, dated so gift cards can expire.
  const escrowEnds = new Date(Date.now() + 2 * 365 * 86_400_000).toISOString();
  for (const gemId of [1, 2, 3, 4, 5, 6, 7, 8]) {
    await rest(db, `/rest/v1/seller_submissions?onchain_gem_id=eq.${gemId}`, { method: 'DELETE' });
    await rest(db, '/rest/v1/seller_submissions', {
      method: 'POST',
      body: JSON.stringify({
        seller_id: users.seller.id,
        seller_wallet: accounts.seller.address.toLowerCase(),
        attributes: { name: `E2E gem ${gemId}` },
        sale_mode: 'buy_now',
        custody_preference: 'protocol_custodian',
        status: 'registered',
        onchain_gem_id: gemId,
        reserve_escrow_ends_at: escrowEnds,
      }),
    });
  }
  return users;
}

function writeOutputs(deployment, db, users) {
  const contracts = {
    VITE_CONTRACT_DGENFT: deployment.DGENFT,
    VITE_CONTRACT_GEM_REGISTRY: deployment.GemRegistry,
    VITE_CONTRACT_PAYMENT_TOKEN_REGISTRY: deployment.PaymentTokenRegistry,
    VITE_CONTRACT_RESERVE_MANAGER: deployment.ReserveManager,
    VITE_CONTRACT_TREASURY: deployment.Treasury,
    VITE_CONTRACT_PRIMARY_SALE_AUCTION: deployment.PrimarySaleAuction,
    VITE_CONTRACT_MARKETPLACE: deployment.Marketplace,
    VITE_CONTRACT_SWAP_ESCROW: deployment.SwapEscrow,
    VITE_CONTRACT_REDEMPTION_MANAGER: deployment.RedemptionManager,
    VITE_CONTRACT_COMPLIANCE_REGISTRY: deployment.ComplianceRegistry,
  };
  // Every key the real .env sets is overridden, so a developer's production
  // settings can never leak into a test build.
  const viteEnv = {
    VITE_DATA_MODE: 'chain',
    VITE_CHAIN_ID: '11155111',
    VITE_DEPLOYMENT_BLOCK: '0',
    VITE_RPC_URL: RPC,
    VITE_RPC_FALLBACK_URL: '',
    VITE_EXPLORER_BASE_URL: 'https://sepolia.etherscan.io',
    VITE_USDC_ADDRESS: deployment.MockUSDC,
    VITE_MUSDC_FAUCET_ADDRESS: deployment.MusdcFaucet,
    VITE_SUPABASE_URL: db.url,
    VITE_SUPABASE_ANON_KEY: db.anonKey,
    VITE_WALLETCONNECT_PROJECT_ID: '',
    VITE_SUMSUB_BACKEND_URL: '',
    VITE_VAPID_PUBLIC_KEY: '',
    VITE_SENTRY_DSN: '',
    VITE_POSTHOG_KEY: '',
    ...contracts,
  };
  fs.writeFileSync(
    path.join(root, '.env.e2e.local'),
    `${Object.entries(viteEnv)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
  );

  const functionsEnv = {
    CHAIN_ID: '11155111',
    RPC_URL: DOCKER_RPC,
    LOGS_RPC_URL: DOCKER_RPC,
    SIWE_RPC_URL: DOCKER_RPC,
    OPERATOR_PRIVATE_KEY: accounts.operator.key,
    DEPLOYMENT_BLOCK: '0',
    DGE_NFT_ADDRESS: deployment.DGENFT,
    GEM_REGISTRY_ADDRESS: deployment.GemRegistry,
    PRIMARY_SALE_AUCTION_ADDRESS: deployment.PrimarySaleAuction,
    MARKETPLACE_ADDRESS: deployment.Marketplace,
    SWAP_ESCROW_ADDRESS: deployment.SwapEscrow,
    REDEMPTION_MANAGER_ADDRESS: deployment.RedemptionManager,
    SITE_ORIGINS: SITE,
    SITE_ORIGIN: SITE,
    RESEND_API_KEY: 're_e2e_capture',
    RESEND_API_URL: MAIL_CAPTURE,
    MAIL_FROM: 'Digital Carat E2E <e2e@digitalcarat.test>',
    NOTIFY_SWEEP_SECRET: 'e2e',
    AUCTION_REFRESH_SECRET: 'e2e',
    DEMAND_REFRESH_SECRET: 'e2e',
  };
  fs.writeFileSync(
    path.join(stackDir, 'functions.env'),
    `${Object.entries(functionsEnv)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
  );

  fs.writeFileSync(
    path.join(stackDir, 'state.json'),
    JSON.stringify({ rpc: RPC, site: SITE, deployment, supabase: db, accounts, users }, null, 2),
  );
}

export async function up() {
  fs.mkdirSync(stackDir, { recursive: true });
  await startChain();
  await installMulticall3();
  const deployment = deployProtocol();
  const db = startSupabase();
  const users = await seedDatabase(db);
  writeOutputs(deployment, db, users);
  log(`ready: chain ${RPC}, Supabase ${db.url}, site will be served on ${SITE}`);
}

export function down() {
  const pidFile = path.join(stackDir, 'anvil.pid');
  if (fs.existsSync(pidFile)) {
    try {
      process.kill(Number(fs.readFileSync(pidFile, 'utf8')));
    } catch {
      /* already stopped */
    }
    fs.rmSync(pidFile);
  }
  try {
    supabase(['stop', '--no-backup'], { stdio: 'inherit' });
  } catch {
    /* not running */
  }
  log('stopped');
}

const command = process.argv[2];
if (import.meta.url === `file://${process.argv[1]}`) {
  if (command === 'up') await up();
  else if (command === 'down') down();
  else {
    console.error('usage: node e2e/stack/stack.mjs up|down');
    process.exit(2);
  }
}
