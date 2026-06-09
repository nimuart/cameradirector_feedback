// Sync canonical source files (src/) into the runtime-served assets/ tree.
// Slopsmith only serves files under <plugin>/assets/ via /api/plugins/<id>/assets/<path>,
// so the locale dictionaries that screen.js fetches at runtime must be mirrored
// there. Edit the files under src/locales/ — never assets/locales/ directly —
// then run `npm run build` (this script) before committing.
import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function copyDir(rel) {
  const from = resolve(root, 'src', rel);
  const to = resolve(root, 'assets', rel);
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
  console.log(`synced  src/${rel}  ->  assets/${rel}`);
}

await copyDir('locales');
console.log('done.');
