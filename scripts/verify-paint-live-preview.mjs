import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:5177/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(1200);

const result = await page.evaluate(async () => {
  // Import paint surface first so bus helpers share its module graph instance.
  const paintMod = await import('/src/utils/paint3dSurface.ts');
  const mod = await import('/src/utils/texturePreviewBus.ts');
  paintMod.__resetPaint3DSurfaceForTests();
  mod.__resetTexturePreviewBusForTests();

  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 32, 32);

  let refreshCalls = 0;
  let notified = 0;
  const unsub = mod.subscribeTexturePreview(() => {
    notified += 1;
  });
  paintMod.bindPaint3DHost({
    getTargetCanvas: () => c,
    refreshPreview: () => {
      refreshCalls += 1;
      mod.setLiveTextureCanvas(c);
      mod.notifyTexturePreview({ sync: true });
    },
  });
  paintMod.paint3dBridge.paintUv(0.5, 0.5, '#ff0000', 2, 'pencil', 1);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const px = ctx.getImageData(16, 16, 1, 1).data;
  const live = mod.getLiveTextureCanvas();
  unsub();
  paintMod.paint3dBridge.endStroke();
  return {
    refreshCalls,
    notified,
    liveIsC: live === c,
    red: px[0],
    green: px[1],
    blue: px[2],
    tick: mod.getTexturePreviewTick(),
  };
});

console.log(JSON.stringify(result, null, 2));
// Reset mutates the app's singleton host — reload so PixelPaintStudio rebinds.
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await browser.close();
if (!result.liveIsC || result.refreshCalls < 1 || result.red < 200 || result.green > 50) {
  console.error('FAIL: live preview sync did not fire as expected');
  process.exit(1);
}
console.log('OK: stamp + refreshPreview + live canvas');