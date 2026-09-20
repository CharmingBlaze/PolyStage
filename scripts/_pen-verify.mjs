import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (err) => console.log('PAGEERROR', err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('CONSOLE', msg.text());
});

await page.goto('http://localhost:5177/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('[aria-label="Pen tool"]', { timeout: 20000 });
await page.waitForTimeout(800);

await page.getByLabel('Pen tool').click();
await page.waitForTimeout(500);

const hud = page.locator('text=PEN').first();
const hudVisible = await hud.isVisible().catch(() => false);
const hudText = hudVisible ? await hud.textContent() : null;
console.log('HUD_VISIBLE', hudVisible, 'HUD', hudText);

const canvas = page.locator('canvas').first();
const box = await canvas.boundingBox();
console.log('CANVAS', box);
if (!box) {
  await page.screenshot({ path: 'scripts/_pen-verify.png' });
  await browser.close();
  process.exit(1);
}

const clicks = [
  [0.38, 0.42],
  [0.58, 0.42],
  [0.58, 0.62],
];
for (const [nx, ny] of clicks) {
  await page.mouse.click(box.x + box.width * nx, box.y + box.height * ny);
  await page.waitForTimeout(250);
}

const hud2 = hudVisible ? await hud.textContent() : await page.locator('text=PEN').first().textContent().catch(() => null);
console.log('HUD2', hud2);
await page.screenshot({ path: 'scripts/_pen-verify.png' });
await browser.close();
if (!hud2 || !/\d+\s*pts/.test(hud2)) {
  console.log('FAIL no points recorded');
  process.exit(1);
}
console.log('OK');
