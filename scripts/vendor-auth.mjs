// Copy the locked official browser SDK into the static deployment artifact.
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sdkRoot = dirname(require.resolve('@supabase/supabase-js/package.json'));
for (const destination of ['assets', 'dist/assets']) {
  await mkdir(resolve(root, destination), { recursive: true });
  await copyFile(resolve(sdkRoot, 'dist/umd/supabase.js'), resolve(root, destination, 'supabase.min.js'));
  await copyFile(resolve(sdkRoot, 'LICENSE'), resolve(root, destination, 'supabase.LICENSE'));
}
console.log('Official Supabase browser SDK copied to both static asset directories.');
