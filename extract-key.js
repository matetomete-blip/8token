const http = require('http');
const WebSocket = require('ws');

(async () => {
  try {
    const tabs = await new Promise((res, rej) => {
      http.get('http://localhost:9222/json', r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => res(JSON.parse(d)));
      }).on('error', rej);
    });

    const tab = tabs.find(t => t.url.includes('supabase.com') && t.type === 'page');
    if (!tab) { console.log('NO_SUPABASE_TAB'); process.exit(1); }
    console.log('TAB_URL:', tab.url);

    // Navigate to API settings page first
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));

    // Navigate to the API keys page
    ws.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url: 'https://supabase.com/dashboard/project/wbkmaeqkypqrkawumdjw/settings/api' } }));
    await new Promise(r => setTimeout(r, 5000));

    // Get page content
    ws.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: { expression: 'document.body.innerText', returnByValue: true } }));

    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('TIMEOUT')), 15000);
      ws.on('message', d => {
        const msg = JSON.parse(d);
        if (msg.id === 2) {
          clearTimeout(timeout);
          resolve(msg.result?.result?.value || '');
        }
      });
    });

    // Look for service_role key (JWT format)
    const matches = result.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g);
    if (matches && matches.length > 0) {
      // The service_role key is typically the longer one or the second one
      for (const m of matches) {
        console.log('JWT_FOUND:', m);
      }
    } else {
      console.log('NO_JWT_FOUND');
      console.log('TEXT_LENGTH:', result.length);
      console.log('PREVIEW:', result.substring(0, 1000));
    }

    ws.close();
    process.exit(0);
  } catch (e) {
    console.log('ERROR:', e.message);
    process.exit(1);
  }
})();