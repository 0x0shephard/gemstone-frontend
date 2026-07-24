import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generatedRoot = resolve(root, 'src/contracts/generated');
const manifest = JSON.parse(await readFile(resolve(generatedRoot, 'checksums.json'), 'utf8'));

for (const [moduleName, expected] of Object.entries(manifest.sha256)) {
  const contents = await readFile(resolve(generatedRoot, `${moduleName}.json`), 'utf8');
  const actual = createHash('sha256').update(contents).digest('hex');
  if (actual !== expected) throw new Error(`${moduleName} ABI checksum mismatch`);
}

console.log(`Verified ${Object.keys(manifest.sha256).length} generated ABI checksums`);

