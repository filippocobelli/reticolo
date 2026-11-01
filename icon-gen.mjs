import { chromium } from 'playwright';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2f39"/><stop offset="1" stop-color="#121418"/></linearGradient>
<linearGradient id="o" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb184"/><stop offset="1" stop-color="#ff6a2b"/></linearGradient></defs>
<rect x="100" y="100" width="824" height="824" rx="190" fill="url(#bg)"/>
<g transform="translate(512 520)" fill="none" stroke-linejoin="round" stroke-linecap="round">
<path d="M0-300 260-150V150L0 300-260 150V-150Z" stroke="url(#o)" stroke-width="44"/>
<path d="M-260-150 0 0 260-150M0 0V300" stroke="#ff9a66" stroke-width="26" opacity=".9"/>
<path d="M-130-225 130-75M130-225-130-75M-130 75 0 150M130 75 0 150M-130 75V225M130 75V225" stroke="#ff9a66" stroke-width="14" opacity=".45"/>
</g></svg>`;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
await p.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await p.screenshot({ path: 'build/icon.png', omitBackground: true }); await b.close();
