import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { embedBlock, extractBlock } from './compose-sync.lib.mjs';

const root = new URL('../../', import.meta.url);
const composePath = fileURLToPath(new URL('docker/compose.prod.yaml', root));
const setupPath = fileURLToPath(new URL('docker/chatwoot/setup.rb', root));

const compose = readFileSync(composePath, 'utf8');
const setup = readFileSync(setupPath, 'utf8');

if (process.argv.includes('--check')) {
  if (extractBlock(compose, 'chatwoot_setup') !== setup) {
    console.error(
      'compose.prod.yaml diverge de docker/chatwoot/setup.rb; rode sync-chatwoot-setup.mjs',
    );
    process.exit(1);
  }
  console.log('compose.prod.yaml e setup.rb estão iguais');
} else {
  writeFileSync(composePath, embedBlock(compose, 'chatwoot_setup', setup));
  console.log('setup.rb embutido em compose.prod.yaml');
}
