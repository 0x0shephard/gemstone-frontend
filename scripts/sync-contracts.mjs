import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactsSource = process.env.CONTRACT_ARTIFACTS_DIR ?? '../gemstone/out';
const artifactsRoot = resolve(root, artifactsSource);
const outputRoot = resolve(root, 'src/contracts/generated');
const modules = [
  'DGENFT',
  'GemRegistry',
  'PaymentTokenRegistry',
  'ReserveManager',
  'Treasury',
  'PrimarySaleAuction',
  'Marketplace',
  'SwapEscrow',
  'RedemptionManager',
  'ComplianceRegistry',
];

await mkdir(outputRoot, { recursive: true });
const checksums = {};

for (const moduleName of modules) {
  const artifactPath = resolve(artifactsRoot, `${moduleName}.sol`, `${moduleName}.json`);
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
  if (!Array.isArray(artifact.abi) || artifact.abi.length === 0) {
    throw new Error(`Artifact has no ABI: ${artifactPath}`);
  }
  const serialized = `${JSON.stringify(artifact.abi, null, 2)}\n`;
  checksums[moduleName] = createHash('sha256').update(serialized).digest('hex');
  await writeFile(resolve(outputRoot, `${moduleName}.json`), serialized);
}

await writeFile(
  resolve(outputRoot, 'checksums.json'),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      generatedFrom: artifactsSource,
      sha256: checksums,
    },
    null,
    2,
  )}\n`,
);

console.log(`Synced ${modules.length} contract ABIs to ${outputRoot}`);
