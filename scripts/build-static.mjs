import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// An explicit public-file list prevents scripts, SQL, private configuration, and node_modules from being published.
const files = [
  '.nojekyll', 'CNAME', 'index.html', 'su-kien.html', 'dang-nhap.html',
  'tuyen-ban-to-chuc.html', 'styles.css', 'app.js', 'member.css', 'member.js',
  'member-config.js', 'member-api.js', 'robots.txt', 'sitemap.xml',
  'assets/fev-logo.png', 'assets/cover-k22.jpg', 'assets/montserrat.woff2',
  'assets/montserrat-italic.woff2'
];
for (const file of files) {
  const destination = resolve(root, 'dist', file);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(resolve(root, file), destination);
}
console.log('Public website files synchronized to dist/.');
