const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const contexts = browser.contexts();
    if (!contexts.length) { console.log('NO_CONTEXTS'); process.exit(1); }

    const context = contexts[0];
    const pages = context.pages();
    console.log('PAGES:', pages.length);

    // Find or create a page for Supabase API settings
    let page = pages.find(p => p.url().includes('supabase.com'));
    if (!page) {
      page = await context.newPage();
    }

    // Navigate to API settings
    console.log('Navigating to API settings...');
    await page.goto('https://supabase.com/dashboard/project/wbkmaeqkypqrkawumdjw/settings/api', { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for the page to fully load
    await page.waitForTimeout(5000);

    // Get all text content
    const text = await page.evaluate(() => document.body.innerText);
    console.log('TEXT_LENGTH:', text.length);

    // Look for JWT tokens (service_role key)
    const jwtPattern = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
    const matches = text.match(jwtPattern);

    if (matches && matches.length > 0) {
      console.log('JWT_COUNT:', matches.length);
      for (let i = 0; i < matches.length; i++) {
        console.log(`JWT_${i}:`, matches[i]);
      }
      // The service_role key is usually the longer one or labeled as such
      // Let's also check for the label
      const serviceRoleMatch = text.match(/service_role[\s\S]*?(eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
      if (serviceRoleMatch) {
        console.log('SERVICE_ROLE_KEY:', serviceRoleMatch[1]);
      }
    } else {
      console.log('NO_JWT_FOUND');
      console.log('PREVIEW:', text.substring(0, 2000));
    }

    await browser.close();
    process.exit(0);
  } catch (e) {
    console.log('ERROR:', e.message);
    process.exit(1);
  }
})();