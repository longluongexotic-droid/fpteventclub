import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// An explicit public-file list prevents scripts, SQL, private configuration, and node_modules from being published.
const files = [
  '.nojekyll', 'CNAME', 'index.html', 'su-kien.html', 'dang-nhap.html',
  'chinh-sach-quyen-rieng-tu.html', 'privacy.css',
  'tuyen-ban-to-chuc.html', 'quan-tri.html', 'styles.css', 'app.js',
  'member.css', 'member.js', 'events.css', 'events.js',
  'recruitment.css', 'recruitment.js', 'admin.css', 'admin.js',
  'robots.txt', 'sitemap.xml',
  'assets/fev-logo.png', 'assets/cover-k22.jpg', 'assets/montserrat.woff2',
  'assets/montserrat-italic.woff2'
];
for (const file of files) {
  const destination = resolve(root, 'dist', file);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(resolve(root, file), destination);
}
// Remove legacy browser-auth files from older, tracked dist/ builds.
for (const obsolete of ['member-config.js', 'member-api.js']) {
  await rm(resolve(root, 'dist', obsolete), { force: true });
}
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseAnonKey = (process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY)?.trim();
if (Boolean(supabaseUrl) !== Boolean(supabaseAnonKey)) {
  throw new Error('SUPABASE_URL and a public Supabase key must be configured together.');
}
if (process.env.REQUIRE_SUPABASE_CONFIG === '1' && !supabaseUrl) {
  throw new Error('Missing public Supabase configuration for deployment.');
}
let clientSource = await readFile(resolve(root, 'supabase-client.js'), 'utf8');
if (!clientSource.includes("'__SUPABASE_URL__'") ||
    !clientSource.includes("'__SUPABASE_ANON_KEY__'")) {
  throw new Error('supabase-client.js must contain only public configuration placeholders.');
}
if (supabaseUrl) {
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(supabaseAnonKey);
  if (!publicKey && supabaseAnonKey.split('.').length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(supabaseAnonKey.split('.')[1], 'base64url').toString('utf8'));
      publicKey = payload.role === 'anon';
    } catch { publicKey = false; }
  }
  if (!/^https:\/\/[a-z0-9.-]+\/?$/i.test(supabaseUrl) || !publicKey) {
    throw new Error('Invalid public Supabase URL or anon key.');
  }
  clientSource = clientSource
    .replace("'__SUPABASE_URL__'", JSON.stringify(supabaseUrl.replace(/\/$/, '')))
    .replace("'__SUPABASE_ANON_KEY__'", JSON.stringify(supabaseAnonKey));
}
await writeFile(resolve(root, 'dist', 'supabase-client.js'), clientSource);
console.log('Public website files synchronized to dist/.');
