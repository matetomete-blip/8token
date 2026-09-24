import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'LOGO');

const browser = await chromium.launch();

const jobs = [
  { html: 'checkout-banner-desktop.html', out: 'checkout-banner-desktop-1200x240.png', w: 1200, h: 240 },
  { html: 'checkout-banner-mobile.html', out: 'checkout-banner-mobile-720x320.png', w: 720, h: 320 },
  { html: 'checkout-banner-desktop-orange.html', out: 'checkout-banner-desktop-orange-1200x240.png', w: 1200, h: 240 },
  { html: 'checkout-banner-mobile-orange.html', out: 'checkout-banner-mobile-orange-720x320.png', w: 720, h: 320 },
];

for (const job of jobs) {
  const page = await browser.newPage({
    viewport: { width: job.w, height: job.h },
    deviceScaleFactor: 2
  });
  await page.goto('file:///' + path.join(__dirname, job.html).replace(/\\/g, '/'));
  await page.waitForTimeout(2000);
  const el = await page.$('.banner');
  await el.screenshot({ path: path.join(outDir, job.out), omitBackground: true });
  console.log('Saved: ' + job.out);
  await page.close();
}

await browser.close();
console.log('Done! All banner sizes saved to LOGO/');