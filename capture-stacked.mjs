import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'LOGO');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 4000 }, deviceScaleFactor: 2 });

await page.goto('file:///' + path.join(__dirname, 'logo-stacked.html').replace(/\\/g, '/'));
await page.waitForTimeout(2000);

const cards = await page.$$('.card');
console.log(`Found ${cards.length} stacked cards`);

const names = [
  'stacked-dark-white-sm',
  'stacked-dark-white-md',
  'stacked-dark-white-lg',
  'stacked-dark-white-xl',
  'stacked-dark-orange-lg',
  'stacked-light-black-sm',
  'stacked-light-black-md',
  'stacked-light-black-lg',
  'stacked-light-black-xl',
  'stacked-light-orange-lg',
  'stacked-transparent-white-lg',
  'stacked-transparent-black-lg',
  'stacked-orange-bg-white-lg',
  'stacked-orange-bg-black-lg',
  'stacked-mono-white-lg',
  'stacked-mono-black-lg',
];

for (let i = 0; i < cards.length; i++) {
  const name = names[i] || `stacked-variant-${i}`;
  const filePath = path.join(outDir, `${name}.png`);
  await cards[i].screenshot({ path: filePath, omitBackground: name.includes('transparent') });
  console.log(`Saved: ${name}.png`);
}

await browser.close();
console.log('Done! All stacked logos saved to LOGO/');