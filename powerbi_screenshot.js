// powerbi_screenshot.js
// Writes r2p.png and oepe.png into the repository workspace (./r2p.png, ./oepe.png)
// Expects env vars: PBI_USER, PBI_PASS, PBI_TOTP_SECRET

const puppeteer = require('puppeteer');
const { authenticator } = require('otplib');
const fs = require('fs');

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    page.setViewport({ width: 1600, height: 1000 });
    page.setDefaultTimeout(60000);

    console.log('-> Open app.powerbi.com');
    await page.goto('https://app.powerbi.com/', { waitUntil: 'networkidle2' });

    console.log('-> Enter email');
    await page.waitForSelector('#email', { visible: true, timeout: 30000 });
    await page.type('#email', process.env.PBI_USER, { delay: 50 });
    await Promise.all([
      page.click('#submitBtn'),
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(()=>{})
    ]);

    console.log('-> Enter password');
    await page.waitForSelector('#i0118', { visible: true, timeout: 30000 });
    await page.type('#i0118', process.env.PBI_PASS, { delay: 50 });
    await Promise.all([
      page.click('#idSIButton9'),
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(()=>{})
    ]);

    console.log('-> Handle TOTP 2FA (if present)');
    try {
      await page.waitForSelector('input[type="tel"]', { visible: true, timeout: 15000 });
      const code = authenticator.generate(process.env.PBI_TOTP_SECRET);
      await page.type('input[type="tel"]', code, { delay: 30 });
      const contBtn = await page.$('#idSubmit_SAOTCC_Continue');
      if (contBtn) {
        await Promise.all([contBtn.click(), page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(()=>{})]);
      } else {
        await page.keyboard.press('Enter');
        await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(()=>{});
      }
      console.log('-> TOTP entered');
    } catch (e) {
      console.log('-> No TOTP step detected, continuing');
    }

    console.log('-> Click No on stay signed in if present');
    try {
      await page.waitForSelector('#idBtn_Back', { visible: true, timeout: 15000 });
      await Promise.all([page.click('#idBtn_Back'), page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(()=>{})]);
    } catch (e) {
      console.log('-> No stay signed-in dialog');
    }

    // Navigate to MAP - Franchisee then Service Time Report
    console.log('-> Navigate to MAP - Franchisee');
    const mapXPaths = [
      "//a[contains(., \"McDonald’s Analytics Platform (MAP) - Franchisee\")]",
      "//a[contains(., \"McDonald's Analytics Platform (MAP) - Franchisee\")]",
      "//*[contains(., \"McDonald’s Analytics Platform (MAP) - Franchisee\")]",
      "//*[contains(., \"McDonald's Analytics Platform (MAP) - Franchisee\")]",
      "//*[contains(., 'McDonald') and contains(., 'MAP')]"
    ];
    let navSuccess = false;
    for (const xp of mapXPaths) {
      const els = await page.$x(xp);
      if (els.length) {
        try { await Promise.all([els[0].click(), page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(()=>{})]); navSuccess = true; break; } catch {}
      }
    }
    if (!navSuccess) console.warn('MAP link not found by XPath searches — update selectors if needed.');

    console.log('-> Click Service Time Report');
    try {
      const srv = await page.$x("//a[contains(., 'Service Time Report') or contains(., 'Service Time')]");
      if (srv.length) {
        await Promise.all([srv[0].click(), page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(()=>{})]);
      } else {
        console.warn('Service Time Report link not found.');
      }
    } catch (e) {
      console.warn('Service Time click attempt error:', e.message);
    }

    // Set date fields to yesterday dd/MM/yyyy
    const d = new Date(); d.setDate(d.getDate() - 1);
    const dd = String(d.getDate()).padStart(2,'0'), mm = String(d.getMonth()+1).padStart(2,'0'), yyyy = d.getFullYear();
    const formatted = `${dd}/${mm}/${yyyy}`;
    const dateFieldIds = ['505ef34d-f37b-80b8-bf4d-ad065c2ffc38','7a295df6-68e2-a36c-a98e-a042d764f071'];
    for (const id of dateFieldIds) {
      const sel = `#${id}`;
      try {
        await page.waitForSelector(sel, { visible: true, timeout: 10000 });
        await page.evaluate((s,val)=>{ const el=document.querySelector(s); if(!el) return false; if(el.tagName==='INPUT'||el.tagName==='TEXTAREA'){ el.value=val; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true;} const nested=el.querySelector('input'); if(nested){ nested.value=val; nested.dispatchEvent(new Event('input',{bubbles:true})); nested.dispatchEvent(new Event('change',{bubbles:true})); return true;} el.innerText=val; return true; }, sel, formatted);
        await sleep(800);
      } catch (e) { console.warn(`Could not set date for ${sel}:`, e.message); }
    }

    await sleep(8000);

    // Capture charts
    const out1 = './r2p.png';
    const out2 = './oepe.png';

    async function capture(title, outPath) {
      const arr = await page.$x(`//div[contains(., '${title}')]/ancestor::div[contains(@class,'visualContainer') or contains(@class,'visual')]`);
      if (arr && arr.length) { await arr[0].screenshot({ path: outPath }); console.log(`Saved ${outPath}`); return true; }
      console.warn(`Chart "${title}" not found.`);
      return false;
    }

    await capture('Average R2P by Store (in second)', out1);
    await capture('Average OEPE by Store (in second)', out2);

    await browser.close();

    // Exit successfully
    process.exit(0);

  } catch (err) {
    console.error('Script error:', err);
    process.exit(1);
  }
})();
