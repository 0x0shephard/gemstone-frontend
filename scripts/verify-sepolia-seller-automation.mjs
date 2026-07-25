import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import {
  createPublicClient,
  getAddress,
  http,
  isAddressEqual,
  parseAbi,
  parseEventLogs,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createSiweMessage } from 'viem/siwe';
import { createClient } from '@supabase/supabase-js';

const PROJECT_REF = 'ozqesbzewekolpeaxaux';
const CHAIN_ID = 11155111;
const SIWE_ORIGIN = 'http://localhost:5173';
const USD = 10n ** 18n;
const hashPattern = /^0x[0-9a-f]{64}$/;

function parseEnv(path) {
  return Object.fromEntries(
    fs
      .readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [
          line.slice(0, index).trim(),
          line
            .slice(index + 1)
            .trim()
            .replace(/^['"]|['"]$/g, ''),
        ];
      }),
  );
}

async function readApiKeys() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  if (input.trim()) return JSON.parse(input);
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.VITE_SUPABASE_ANON_KEY;
  if (!serviceRole || !anon) {
    throw new Error(
      'Pipe `supabase projects api-keys -o json` into this script or provide server-only API keys',
    );
  }
  return [
    { name: 'service_role', api_key: serviceRole },
    { name: 'anon', api_key: anon },
  ];
}

function requiredKey(keys, name) {
  const value = keys.find((key) => key.name === name)?.api_key;
  if (!value) throw new Error(`Supabase ${name} key was not provided`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function expectedPrice(caratWeight) {
  const microCarats = BigInt(Math.ceil(caratWeight * 1_000_000));
  let wholeUsd = (microCarats * 500n + 999_999n) / 1_000_000n;
  if (wholeUsd < 100n) wholeUsd = 100n;
  if (wholeUsd > 25_000n) wholeUsd = 25_000n;
  return wholeUsd * USD;
}

function safeError(error) {
  const message =
    error && typeof error === 'object' && typeof error.message === 'string'
      ? error.message
      : String(error);
  return message
    .split('\n')[0]
    .replace(/https?:\/\/\S+/gi, '[endpoint]')
    .slice(0, 500);
}

const keys = await readApiKeys();
const serviceRoleKey = requiredKey(keys, 'service_role');
const anonKey = requiredKey(keys, 'anon');
const frontendEnv = parseEnv('.env');
const contractsEnv = parseEnv('../gemstone/.env');
const deployment = JSON.parse(fs.readFileSync('../gemstone/deployments/sepolia.json', 'utf8'));
const supabaseUrl = frontendEnv.VITE_SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`;
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const client = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(contractsEnv.SEPOLIA_RPC_URL, { retryCount: 3, timeout: 30_000 }),
});
let seller = privateKeyToAccount(generatePrivateKey());
const password = `Dc-${randomBytes(24).toString('base64url')}!9a`;
const testRun = Date.now();
const email = `digital-carat-e2e-${testRun}@example.com`;
const createdObjects = [];

const registryAbi = parseAbi([
  'function sellerApproved(address seller) view returns (bool)',
  'function getGem(uint256 gemId) view returns ((address seller,address custodian,string metadataURI,bytes32 certificateHash,uint256 priceUsd,uint256 tokenId,bytes32 redemptionRequestHash,uint8 status))',
  'function valuationHash(uint256 gemId) view returns (bytes32)',
  'function valuationMatrixHash(uint256 gemId) view returns (bytes32)',
  'function approvedValuationUsd(uint256 gemId) view returns (uint256)',
  'function primarySaleMode(uint256 gemId) view returns (uint8)',
  'event GemRegistered(uint256 indexed gemId, address indexed seller, address indexed custodian)',
]);
const primarySaleAbi = parseAbi([
  'function auctions(uint256 gemId) view returns (bool exists,bool settled,uint64 startTime,uint64 endTime,uint256 floorUsd,address highestBidder,address paymentAsset,uint256 amount,uint256 usdValue,uint256 reserveUsd)',
]);

if (process.env.DIAGNOSE_ONLY === '1') {
  const { data: listedUsers, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1_000,
  });
  if (listError) throw listError;
  const users = listedUsers.users
    .filter((user) => user.email?.startsWith('digital-carat-e2e-'))
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, 3);
  const diagnostics = [];
  for (const user of users) {
    const [wallets, nonces, submissions, audits] = await Promise.all([
      admin
        .from('wallet_links')
        .select('wallet_address,is_primary,verified_at')
        .eq('profile_id', user.id),
      admin.from('siwe_nonces').select('used_at,expires_at').eq('profile_id', user.id),
      admin
        .from('seller_submissions')
        .select(
          'id,status,sale_mode,verification_provider,activation_state,activation_error,onchain_gem_id,created_at',
        )
        .eq('seller_id', user.id),
      admin
        .from('audit_records')
        .select('action,details,created_at')
        .eq('profile_id', user.id)
        .order('created_at', { ascending: true }),
    ]);
    diagnostics.push({
      userId: user.id,
      createdAt: user.created_at,
      wallets: wallets.data,
      nonces: nonces.data,
      submissions: submissions.data,
      audits: audits.data,
    });
  }
  console.log(JSON.stringify(diagnostics, null, 2));
  process.exit(0);
}

async function invoke(functionName, body) {
  const { data, error } = await client.functions.invoke(functionName, { body });
  return { data, error };
}

if (process.env.RESUME_LATEST === '1') {
  const { data: listedUsers, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1_000,
  });
  if (listError) throw listError;
  const user = listedUsers.users
    .filter((candidate) => candidate.email?.startsWith('digital-carat-e2e-'))
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
  if (!user?.email) throw new Error('No E2E user is available to resume');
  const resumePassword = `Dc-${randomBytes(24).toString('base64url')}!9a`;
  const { error: passwordError } = await admin.auth.admin.updateUserById(user.id, {
    password: resumePassword,
  });
  if (passwordError) throw passwordError;
  const { error: signInError } = await client.auth.signInWithPassword({
    email: user.email,
    password: resumePassword,
  });
  if (signInError) throw signInError;
  const { data: submissions, error: submissionError } = await admin
    .from('seller_submissions')
    .select('id,status,activation_state,activation_error,onchain_gem_id')
    .eq('seller_id', user.id)
    .order('created_at', { ascending: true });
  if (submissionError) throw submissionError;
  const submission = submissions[0];
  if (!submission) throw new Error('The latest E2E user has no seller submission');
  const result = await invoke('v1-seller-activate', { submissionId: submission.id });
  let responseBody;
  if (result.error?.context instanceof Response) {
    try {
      responseBody = await result.error.context.clone().json();
    } catch {
      responseBody = undefined;
    }
  }
  const { data: updated, error: updatedError } = await admin
    .from('seller_submissions')
    .select('id,status,activation_state,activation_error,onchain_gem_id')
    .eq('id', submission.id)
    .single();
  if (updatedError) throw updatedError;
  console.log(
    JSON.stringify(
      {
        userId: user.id,
        functionData: result.data,
        functionError: result.error?.message,
        responseBody,
        submission: updated,
      },
      null,
      2,
    ),
  );
  process.exit(result.error || result.data?.error ? 1 : 0);
}

if (process.env.ADD_AUCTION_LATEST === '1') {
  const { data: listedUsers, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1_000,
  });
  if (listError) throw listError;
  const user = listedUsers.users
    .filter((candidate) => candidate.email?.startsWith('digital-carat-e2e-'))
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
  if (!user?.email) throw new Error('No E2E user is available for the auction test');
  const { data: existingAuction, error: existingError } = await admin
    .from('seller_submissions')
    .select('id,status')
    .eq('seller_id', user.id)
    .eq('sale_mode', 'auction')
    .maybeSingle();
  if (existingError) throw existingError;
  if (existingAuction) {
    throw new Error(`E2E user already has auction submission ${existingAuction.id}`);
  }
  const resumePassword = `Dc-${randomBytes(24).toString('base64url')}!9a`;
  const { error: passwordError } = await admin.auth.admin.updateUserById(user.id, {
    password: resumePassword,
  });
  if (passwordError) throw passwordError;
  const { error: signInError } = await client.auth.signInWithPassword({
    email: user.email,
    password: resumePassword,
  });
  if (signInError) throw signInError;
  const { data: walletLink, error: walletError } = await admin
    .from('wallet_links')
    .select('wallet_address')
    .eq('profile_id', user.id)
    .eq('is_primary', true)
    .single();
  if (walletError) throw walletError;
  seller = { address: getAddress(walletLink.wallet_address) };
  const auction = await createAndActivate(user.id, 'auction', 2.001, 'AUCTION');
  console.log(
    JSON.stringify(
      {
        ok: true,
        network: 'ethereum-sepolia',
        testRun,
        testUserId: user.id,
        sellerWallet: seller.address,
        auction,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

async function uploadEvidence(userId, submissionId, label) {
  const certificate = Buffer.from(
    `%PDF-1.4\n% Digital Carat ${label} automated Sepolia test certificate\n%%EOF\n`,
  );
  const media = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
    'base64',
  );
  for (const evidence of [
    {
      category: 'certificate',
      bucket: 'certificates',
      mimeType: 'application/pdf',
      name: `${label}.pdf`,
      bytes: certificate,
    },
    {
      category: 'gem_media',
      bucket: 'gem-media',
      mimeType: 'image/png',
      name: `${label}.png`,
      bytes: media,
    },
  ]) {
    const objectPath = `${userId}/${submissionId}/${randomUUID()}-${evidence.name}`;
    const { error: uploadError } = await client.storage
      .from(evidence.bucket)
      .upload(objectPath, evidence.bytes, {
        contentType: evidence.mimeType,
        upsert: false,
      });
    if (uploadError) throw uploadError;
    createdObjects.push({ bucket: evidence.bucket, objectPath });
    const { error: recordError } = await client.from('evidence_files').insert({
      owner_id: userId,
      submission_id: submissionId,
      category: evidence.category,
      bucket: evidence.bucket,
      object_path: objectPath,
      mime_type: evidence.mimeType,
      byte_size: evidence.bytes.length,
      sha256: sha256(evidence.bytes),
    });
    if (recordError) throw recordError;
  }
}

async function activateUntilRegistered(submissionId, sellerWallet) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const { data: row, error: rowError } = await admin
      .from('seller_submissions')
      .select('status,activation_state,activation_error')
      .eq('id', submissionId)
      .single();
    if (rowError) throw rowError;
    if (row.status === 'registered') return;
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, 2_000));
    const result = await invoke('v1-seller-activate', { submissionId, sellerWallet });
    if (result.error && attempt === 5) throw result.error;
  }
  throw new Error(`Submission ${submissionId} did not reach registered state`);
}

async function recentSellerRegistrationLogs(sellerAddress) {
  const latestBlock = await publicClient.getBlockNumber();
  const lowerBound = latestBlock > 127n ? latestBlock - 127n : BigInt(deployment.deploymentBlock);
  const logs = [];
  let toBlock = latestBlock;
  while (toBlock >= lowerBound) {
    const candidateFrom = toBlock >= 9n ? toBlock - 9n : 0n;
    const fromBlock = candidateFrom > lowerBound ? candidateFrom : lowerBound;
    logs.push(
      ...(await publicClient.getLogs({
        address: deployment.addresses.GemRegistry,
        event: {
          type: 'event',
          name: 'GemRegistered',
          inputs: [
            { name: 'gemId', type: 'uint256', indexed: true },
            { name: 'seller', type: 'address', indexed: true },
            { name: 'custodian', type: 'address', indexed: true },
          ],
        },
        args: { seller: sellerAddress },
        fromBlock,
        toBlock,
      })),
    );
    if (fromBlock === lowerBound) break;
    toBlock = fromBlock - 1n;
  }
  return logs;
}

if (process.env.VERIFY_LATEST === '1') {
  const { data: listedUsers, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1_000,
  });
  if (listError) throw listError;
  const user = listedUsers.users
    .filter((candidate) => candidate.email?.startsWith('digital-carat-e2e-'))
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
  if (!user) throw new Error('No E2E user is available for verification');
  const { data: walletLink, error: walletError } = await admin
    .from('wallet_links')
    .select('wallet_address')
    .eq('profile_id', user.id)
    .eq('is_primary', true)
    .single();
  if (walletError) throw walletError;
  const sellerAddress = getAddress(walletLink.wallet_address);
  const { data: submissions, error: submissionError } = await admin
    .from('seller_submissions')
    .select(
      'id,status,sale_mode,verification_provider,certificate_hash,valuation_hash,valuation_matrix_hash,valuation_method,approved_valuation_usd,onchain_gem_id,activation_state,activation_error,registration_tx_hash,custody_tx_hash,valuation_tx_hash,listing_tx_hash,auction_tx_hash,activation_tx_hash',
    )
    .eq('seller_id', user.id)
    .order('created_at', { ascending: true });
  if (submissionError) throw submissionError;
  assert(submissions.length === 2, 'Expected one buy-now and one auction E2E submission');
  const verified = [];
  for (const submission of submissions) {
    const gemId = BigInt(submission.onchain_gem_id);
    const [gem, valuationHash, valuationMatrixHash, approvedValuationUsd, saleMode, auction] =
      await Promise.all([
        publicClient.readContract({
          address: deployment.addresses.GemRegistry,
          abi: registryAbi,
          functionName: 'getGem',
          args: [gemId],
        }),
        publicClient.readContract({
          address: deployment.addresses.GemRegistry,
          abi: registryAbi,
          functionName: 'valuationHash',
          args: [gemId],
        }),
        publicClient.readContract({
          address: deployment.addresses.GemRegistry,
          abi: registryAbi,
          functionName: 'valuationMatrixHash',
          args: [gemId],
        }),
        publicClient.readContract({
          address: deployment.addresses.GemRegistry,
          abi: registryAbi,
          functionName: 'approvedValuationUsd',
          args: [gemId],
        }),
        publicClient.readContract({
          address: deployment.addresses.GemRegistry,
          abi: registryAbi,
          functionName: 'primarySaleMode',
          args: [gemId],
        }),
        publicClient.readContract({
          address: deployment.addresses.PrimarySaleAuction,
          abi: primarySaleAbi,
          functionName: 'auctions',
          args: [gemId],
        }),
      ]);
    const expectedMode = submission.sale_mode === 'auction' ? 2 : 1;
    assert(submission.status === 'registered', `Gem ${gemId}: database status mismatch`);
    assert(
      submission.activation_state ===
        (submission.sale_mode === 'auction' ? 'auction_created' : 'listed'),
      `Gem ${gemId}: activation state mismatch`,
    );
    assert(submission.activation_error === null, `Gem ${gemId}: unexpected activation error`);
    assert(submission.verification_provider === 'mvp-auto', `Gem ${gemId}: verifier mismatch`);
    assert(
      submission.valuation_method === 'mvp-flat-carat-v1',
      `Gem ${gemId}: valuation method mismatch`,
    );
    assert(gem.status === 4, `Gem ${gemId}: registry status is not Listed`);
    assert(isAddressEqual(gem.seller, sellerAddress), `Gem ${gemId}: seller mismatch`);
    assert(gem.certificateHash === submission.certificate_hash, `Gem ${gemId}: evidence mismatch`);
    assert(
      gem.priceUsd === BigInt(submission.approved_valuation_usd),
      `Gem ${gemId}: price mismatch`,
    );
    assert(valuationHash === submission.valuation_hash, `Gem ${gemId}: valuation hash mismatch`);
    assert(
      valuationMatrixHash === submission.valuation_matrix_hash,
      `Gem ${gemId}: matrix hash mismatch`,
    );
    assert(
      approvedValuationUsd === BigInt(submission.approved_valuation_usd),
      `Gem ${gemId}: approved valuation mismatch`,
    );
    assert(saleMode === expectedMode, `Gem ${gemId}: primary sale mode mismatch`);
    assert(auction[0] === (expectedMode === 2), `Gem ${gemId}: auction existence mismatch`);
    for (const field of [
      'registration_tx_hash',
      'custody_tx_hash',
      'valuation_tx_hash',
      'listing_tx_hash',
      'activation_tx_hash',
    ]) {
      assert(hashPattern.test(submission[field] ?? ''), `Gem ${gemId}: missing ${field}`);
    }
    if (expectedMode === 2) {
      assert(
        hashPattern.test(submission.auction_tx_hash ?? ''),
        `Gem ${gemId}: missing auction tx`,
      );
      assert(auction[4] === gem.priceUsd, `Gem ${gemId}: auction floor mismatch`);
    }
    const registrationReceipt = await publicClient.getTransactionReceipt({
      hash: submission.registration_tx_hash,
    });
    const registrationEvents = parseEventLogs({
      abi: registryAbi,
      eventName: 'GemRegistered',
      logs: registrationReceipt.logs,
    });
    assert(
      registrationEvents.length === 1 &&
        registrationEvents[0].args.gemId?.toString() === gemId.toString(),
      `Gem ${gemId}: registration receipt mismatch`,
    );
    verified.push({
      submissionId: submission.id,
      gemId: gemId.toString(),
      saleMode: submission.sale_mode,
      activationState: submission.activation_state,
      approvedValuationUsd: submission.approved_valuation_usd,
      transactionHashes: {
        registration: submission.registration_tx_hash,
        custody: submission.custody_tx_hash,
        valuation: submission.valuation_tx_hash,
        listing: submission.listing_tx_hash,
        auction: submission.auction_tx_hash,
      },
    });
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        network: 'ethereum-sepolia',
        testUserId: user.id,
        sellerWallet: sellerAddress,
        submissions: verified,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

async function createAndActivate(userId, saleMode, caratWeight, suffix) {
  const attributes = {
    name: `Digital Carat E2E ${suffix} ${testRun}`,
    gemstoneType: saleMode === 'auction' ? 'Test Sapphire' : 'Test Ruby',
    origin: 'Sepolia test fixture',
    caratWeight,
    dimensions: '8.0 × 6.0 × 4.0',
    color: saleMode === 'auction' ? 'Test blue' : 'Test red',
    clarity: 'Synthetic test clarity',
    cut: 'Oval',
    treatment: 'None — test fixture',
    gradingLab: 'Digital Carat E2E',
    certificateNumber: `E2E-${testRun}-${suffix}`,
  };
  const create = await invoke('v1-seller-submit', {
    action: 'create',
    clientSubmissionId: randomUUID(),
    sellerWallet: seller.address,
    attributes,
    saleMode,
    custodyPreference: 'protocol_custodian',
    notes: 'Automated live Sepolia seller activation test. No physical gemstone.',
  });
  if (create.error || create.data?.error || !create.data?.submissionId) {
    throw create.error ?? new Error(create.data?.error ?? 'Seller submission creation failed');
  }
  const submissionId = String(create.data.submissionId);
  await uploadEvidence(userId, submissionId, suffix.toLowerCase());
  const verification = await invoke('v1-seller-submit', {
    action: 'verify',
    submissionId,
    sellerWallet: seller.address,
  });
  if (
    verification.data?.status !== 'registered' &&
    verification.data?.status !== 'approved' &&
    verification.error
  ) {
    throw verification.error;
  }
  await activateUntilRegistered(submissionId, seller.address);

  const { data: submission, error } = await admin
    .from('seller_submissions')
    .select(
      'id,status,sale_mode,verification_provider,certificate_hash,valuation_hash,valuation_matrix_hash,valuation_method,approved_valuation_usd,onchain_gem_id,activation_state,activation_error,registration_tx_hash,custody_tx_hash,valuation_tx_hash,listing_tx_hash,auction_tx_hash,activation_tx_hash',
    )
    .eq('id', submissionId)
    .single();
  if (error) throw error;
  const gemId = BigInt(submission.onchain_gem_id);
  const [gem, valuationHash, valuationMatrixHash, approvedValuationUsd, primarySaleMode, auction] =
    await Promise.all([
      publicClient.readContract({
        address: deployment.addresses.GemRegistry,
        abi: registryAbi,
        functionName: 'getGem',
        args: [gemId],
      }),
      publicClient.readContract({
        address: deployment.addresses.GemRegistry,
        abi: registryAbi,
        functionName: 'valuationHash',
        args: [gemId],
      }),
      publicClient.readContract({
        address: deployment.addresses.GemRegistry,
        abi: registryAbi,
        functionName: 'valuationMatrixHash',
        args: [gemId],
      }),
      publicClient.readContract({
        address: deployment.addresses.GemRegistry,
        abi: registryAbi,
        functionName: 'approvedValuationUsd',
        args: [gemId],
      }),
      publicClient.readContract({
        address: deployment.addresses.GemRegistry,
        abi: registryAbi,
        functionName: 'primarySaleMode',
        args: [gemId],
      }),
      publicClient.readContract({
        address: deployment.addresses.PrimarySaleAuction,
        abi: primarySaleAbi,
        functionName: 'auctions',
        args: [gemId],
      }),
    ]);

  const price = expectedPrice(caratWeight);
  assert(submission.status === 'registered', `${suffix}: database status is not registered`);
  assert(
    submission.activation_state === (saleMode === 'auction' ? 'auction_created' : 'listed'),
    `${suffix}: activation state is incomplete`,
  );
  assert(submission.verification_provider === 'mvp-auto', `${suffix}: verifier mismatch`);
  assert(
    submission.valuation_method === 'mvp-flat-carat-v1',
    `${suffix}: pricing version mismatch`,
  );
  assert(
    BigInt(submission.approved_valuation_usd) === price,
    `${suffix}: database valuation mismatch`,
  );
  assert(gem.status === 4, `${suffix}: on-chain gem is not listed`);
  assert(isAddressEqual(gem.seller, seller.address), `${suffix}: seller mismatch`);
  assert(
    isAddressEqual(gem.custodian, getAddress(deployment.admin)),
    `${suffix}: custodian mismatch`,
  );
  assert(gem.priceUsd === price, `${suffix}: registry price mismatch`);
  assert(approvedValuationUsd === price, `${suffix}: approved valuation mismatch`);
  assert(valuationHash === submission.valuation_hash, `${suffix}: valuation hash mismatch`);
  assert(
    valuationMatrixHash === submission.valuation_matrix_hash,
    `${suffix}: matrix hash mismatch`,
  );
  assert(primarySaleMode === (saleMode === 'auction' ? 2 : 1), `${suffix}: sale mode mismatch`);
  assert(auction[0] === (saleMode === 'auction'), `${suffix}: auction existence mismatch`);
  if (saleMode === 'auction') {
    assert(auction[4] === price, `${suffix}: auction floor mismatch`);
    assert(auction[3] > auction[2], `${suffix}: auction window is invalid`);
  }
  for (const field of [
    'registration_tx_hash',
    'custody_tx_hash',
    'valuation_tx_hash',
    'listing_tx_hash',
    'activation_tx_hash',
  ]) {
    assert(hashPattern.test(submission[field] ?? ''), `${suffix}: missing ${field}`);
  }
  if (saleMode === 'auction') {
    assert(hashPattern.test(submission.auction_tx_hash ?? ''), `${suffix}: missing auction hash`);
  }

  const retry = await invoke('v1-seller-activate', { submissionId });
  if (retry.error || retry.data?.error) {
    throw retry.error ?? new Error(retry.data.error);
  }
  assert(String(retry.data.onchainGemId) === gemId.toString(), `${suffix}: retry changed gem id`);

  const logs = await recentSellerRegistrationLogs(seller.address);
  const matchingGemIds = [];
  for (const log of logs) {
    const candidate = await publicClient.readContract({
      address: deployment.addresses.GemRegistry,
      abi: registryAbi,
      functionName: 'getGem',
      args: [log.args.gemId],
    });
    if (candidate.certificateHash === submission.certificate_hash) {
      matchingGemIds.push(log.args.gemId.toString());
    }
  }
  assert(
    matchingGemIds.length === 1 && matchingGemIds[0] === gemId.toString(),
    `${suffix}: retry created a duplicate registration`,
  );

  return {
    submissionId,
    gemId: gemId.toString(),
    saleMode,
    approvedValuationUsd: price.toString(),
    activationState: submission.activation_state,
    transactionHashes: {
      registration: submission.registration_tx_hash,
      custody: submission.custody_tx_hash,
      valuation: submission.valuation_tx_hash,
      listing: submission.listing_tx_hash,
      auction: submission.auction_tx_hash,
    },
  };
}

try {
  const { data: createdUser, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Digital Carat Sepolia E2E' },
  });
  if (userError || !createdUser.user) throw userError ?? new Error('Test user creation failed');
  const userId = createdUser.user.id;
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const nonce = await invoke('v1-siwe-nonce', {
    domain: 'localhost:5173',
    uri: SIWE_ORIGIN,
    chainId: CHAIN_ID,
  });
  if (nonce.error || !nonce.data?.nonce) {
    throw nonce.error ?? new Error(nonce.data?.error ?? 'SIWE nonce issuance failed');
  }
  const message = createSiweMessage({
    address: seller.address,
    chainId: CHAIN_ID,
    domain: 'localhost:5173',
    uri: SIWE_ORIGIN,
    version: '1',
    nonce: nonce.data.nonce,
    statement: 'Link this wallet as your verified Digital Carat primary wallet.',
    issuedAt: new Date(),
    expirationTime: new Date(nonce.data.expiresAt),
  });
  const signature = await seller.signMessage({ message });
  const linked = await invoke('v1-siwe-verify', { message, signature });
  if (linked.error || linked.data?.error) {
    throw linked.error ?? new Error(linked.data.error);
  }
  assert(
    isAddressEqual(linked.data.wallet_address, seller.address),
    'SIWE-linked wallet does not match the test seller',
  );

  const sellerApprovedBefore = await publicClient.readContract({
    address: deployment.addresses.GemRegistry,
    abi: registryAbi,
    functionName: 'sellerApproved',
    args: [seller.address],
  });
  assert(
    sellerApprovedBefore === false,
    'Generated seller was unexpectedly approved before intake',
  );

  const buyNow = await createAndActivate(userId, 'buy_now', 1.234, 'BUY-NOW');
  const auction = await createAndActivate(userId, 'auction', 2.001, 'AUCTION');
  const sellerApprovedAfter = await publicClient.readContract({
    address: deployment.addresses.GemRegistry,
    abi: registryAbi,
    functionName: 'sellerApproved',
    args: [seller.address],
  });
  assert(sellerApprovedAfter === true, 'Seller was not approved during activation');

  console.log(
    JSON.stringify(
      {
        ok: true,
        network: 'ethereum-sepolia',
        testRun,
        testUserId: userId,
        sellerWallet: seller.address,
        siweVerified: true,
        evidenceUploads: createdObjects.length,
        buyNow,
        auction,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: safeError(error) }, null, 2));
  process.exitCode = 1;
}
