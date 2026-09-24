import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, 'checkout-banner-image.html');
const outPath = path.join(__dirname, 'LOGO', 'checkout-trust-banner.png');

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 600, height: 400 },
  deviceScaleFactor: 2
});

await page.goto('file:///' + htmlPath.replace(/\\/g, '/'));
await page.waitForTimeout(2000);

const el = await page.$('.trust-banner');
await el.screenshot({ path: outPath, omitBackground: true });

await browser.close();
console.log('Banner image saved to LOGO/checkout-trust-banner.png');