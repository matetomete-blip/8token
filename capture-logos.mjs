import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'logo-assets');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 3000 }, deviceScaleFactor: 2 });

await page.goto('file:///' + path.join(__dirname, 'logo-variants.html').replace(/\\/g, '/'));
await page.waitForTimeout(2000);

const cards = await page.$$('.card');
console.log(`Found ${cards.length} cards`);

const names = [
  'dark-white-md',
  'dark-white-lg',
  'dark-white-xl',
  'dark-orange-lg',
  'light-black-md',
  'light-black-lg',
  'light-black-xl',
  'light-orange-lg',
  'transparent-white-lg',
  'transparent-black-lg',
  'orange-bg-white-lg',
  'orange-bg-black-lg',
  'icon-only-dark',
  'icon-only-light',
  'mono-white-lg',
  'mono-black-lg',
];

for (let i = 0; i < cards.length; i++) {
  const name = names[i] || `variant-${i}`;
  const filePath = path.join(outDir, `${name}.png`);
  await cards[i].screenshot({ path: filePath, omitBackground: name.includes('transparent') });
  console.log(`Saved: ${name}.png`);
}

// Also capture individual icon-only SVGs at high res for favicon use
const iconSizes = [16, 32, 64, 128, 256, 512];
for (const size of iconSizes) {
  const iconPage = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await iconPage.setContent(`
    <html><body style="margin:0;padding:0;background:transparent;display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;">
    <svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M32 4C18.745 4 8 14.745 8 28v24c0 2.21 1.79 4 4 4 1.1 0 2.1-.45 2.83-1.17L18 51.66l3.17 3.17C21.9 55.55 22.9 56 24 56s2.1-.45 2.83-1.17L30 51.66l3.17 3.17C33.9 55.55 34.9 56 36 56s2.1-.45 2.83-1.17L42 51.66l3.17 3.17C45.9 55.55 46.9 56 48 56c2.21 0 4-1.79 4-4V28C52 14.745 41.255 4 32 4z" fill="#FF6B2B"/>
      <circle cx="22" cy="26" r="5" fill="#111111"/>
      <circle cx="42" cy="26" r="5" fill="#111111"/>
    </svg>
    </body></html>
  `);
  await iconPage.screenshot({ path: path.join(outDir, `icon-${size}px.png`), omitBackground: true });
  console.log(`Saved: icon-${size}px.png`);
  await iconPage.close();
}

await browser.close();
console.log('Done! All logos saved to logo-assets/');