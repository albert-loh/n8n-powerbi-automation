// powerbi_screenshot.js
// Run: node powerbi_screenshot.js
// Required env vars: PBI_USER, PBI_PASS, PBI_TOTP_SECRET
// Prints JSON with r2p_url and oepe_url (uploaded to transfer.sh)

const puppeteer = require('puppeteer');
const { authenticator } = require('otplib');
const { execSync } = require('child_process');
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

    // --- login email
    console.log('-> Enter email');
    await page.waitForSelector('#email', { visible: true, timeout: 30000 });
    await page.type('#email', process.env.PBI_USER, { delay: 50 });
    await Promise.all([
      page.click('#submitBtn'),
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(()=>{})
    ]);

    // --- password
    console.log('-> Enter password');
    await page.waitForSelector('#i0118', { visible: true, timeout: 30000 });
    await page.type('#i0118', process.env.PBI_PASS, { delay: 50 });
    await Promise.all([
      page.click('#idSIButton9'),
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(()=>{})
    ]);

    // --- TOTP 2FA
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
      console.log('-> No TOTP step found or timed out, continuing');
    }

    // --- Stay signed in? click No
    try {
      await page.waitForSelector('#idBtn_Back', { visible: true, timeout: 15000 });
      await Promise.all([
        page.click('#idBtn_Back'),
        page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(()=>{})
      ]);
      console.log('-> Clicked "No" for stay signed-in');
    } catch (e) {
      console.log('-> No "Stay signed-in" prompt found, continuing');
    }

    // --- Navigate to MAP - Franchisee
    console.log('-> Find MAP link and click');
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
        try {
          await Promise.all([els[0].click(), page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(()=>{})]);
          navSuccess = true;
          break;
        } catch {}
      }
    }
    if (!navSuccess) console.log('⚠️ MAP link not found by XPath searches — you may need to adjust selectors.');

    // --- Click Service Time Report
    console.log('-> Find "Service Time Report" and click');
    try {
      const srv = await page.$x("//a[contains(., 'Service Time Report') or contains(., 'Service Time')]");
      if (srv.length) {
        await Promise.all([srv[0].click(), page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(()=>{})]);
      } else {
        console.log('⚠️ Service Time Report link not found by simple XPath.');
      }
    } catch (e) {
      console.log('-> Service Time click attempt error:', e.message);
    }

    // --- Set date fields to yesterday in dd/MM/yyyy
    console.log('-> Set date fields to yesterday (dd/MM/yyyy)');
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const formatted = `${dd}/${mm}/${yyyy}`;

    const dateFieldIds = [
      '505ef34d-f37b-80b8-bf4d-ad065c2ffc38',
      '7a295df6-68e2-a36c-a98e-a042d764f071'
    ];

    for (const id of dateFieldIds) {
      const sel = `#${id}`;
      try {
        await page.waitForSelector(sel, { visible: true, timeout: 10000 });
        await page.evaluate((s, val) => {
          const el = document.querySelector(s);
          if (!el) return false;
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
          const nested = el.querySelector('input');
          if (nested) {
            nested.value = val;
            nested.dispatchEvent(new Event('input', { bubbles: true }));
            nested.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
          el.innerText = val;
          return true;
        }, sel, formatted);
        await sleep(800);
      } catch (e) {
        console.log(`⚠️ Could not set date for #${id}: ${e.message}`);
      }
    }

    // Wait for visuals to refresh
    await sleep(8000);

    // --- Capture charts by title and save to /tmp
    console.log('-> Capture charts');
    const savePath1 = '/tmp/r2p.png';
    const savePath2 = '/tmp/oepe.png';

    const findAndCapture = async (title, outPath) => {
      try {
        const candidates = await page.$x(`//div[contains(., '${title}')]/ancestor::div[contains(@class,'visualContainer') or contains(@class,'visual')]`);
        if (candidates && candidates.length) {
          await candidates[0].screenshot({ path: outPath });
          console.log(`-> Saved ${outPath}`);
          return true;
        } else {
          console.log(`⚠️ Chart with title "${title}" not found via XPath.`);
          return false;
        }
      } catch (e) {
        console.log('Error capturing chart', e.message);
        return false;
      }
    };

    await findAndCapture('Average R2P by Store (in second)', savePath1);
    await findAndCapture('Average OEPE by Store (in second)', savePath2);

    await browser.close();

    // --- Upload to transfer.sh to get public URLs
    console.log('-> Uploading to transfer.sh (temporary public URLs)');
    const upload = filePath => {
      try {
        const cmd = `curl -s --upload-file "${filePath}" https://transfer.sh/${filePath.split('/').pop()}`;
        const out = execSync(cmd, { encoding: 'utf8' });
        if (!out) return null;
        return String(out).trim();
      } catch (e) {
        console.log('Upload failed for', filePath, e.message);
        return null;
      }
    };

    const r2pUrl = fs.existsSync(savePath1) ? upload(savePath1) : null;
    const oepeUrl = fs.existsSync(savePath2) ? upload(savePath2) : null;

    const result = { r2p_url: r2pUrl, oepe_url: oepeUrl };
    console.log('-> RESULT-JSON-BEGIN');
    console.log(JSON.stringify(result));
    console.log('-> RESULT-JSON-END');

    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (err) {
    console.error('Script error:', err);
    console.log(JSON.stringify({ r2p_url: null, oepe_url: null, error: String(err) }));
    process.exit(1);
  }
})();
