import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const markup = readFileSync('index.html', 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<link\b[^>]*>/gi, '');
const styles = readFileSync('src/styles.css', 'utf8');
const font = readFileSync('public/fonts/DepartureMono-Regular.woff2').toString('base64');

async function showPanel(page: Page, edge: string, width: number, height: number, plain = false) {
  await page.setViewportSize({ width, height });
  await page.evaluate(({ edge, width, height, plain }) => {
    document.documentElement.dataset.dockEdge = edge;
    document.body.classList.add('is-tauri-native');
    const widget = document.querySelector<HTMLElement>('#dynamic-island')!;
    widget.className = 'island-widget state-expanded expanded-ready tab-music';
    Object.assign(widget.style, { width: width + 'px', height: height + 'px', position: 'absolute',
      top: '0', left: '0', transform: 'none', maxHeight: height + 'px', minHeight: '0' });
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
    document.querySelector('#panel-music')!.classList.add('active');
    document.querySelector('#music-lyrics-card')!.className = 'lyrics-card' + (plain ? ' is-plain-lyrics' : '');
    document.querySelector('#music-card-tag')!.textContent = 'MEDIA SISTEM · LRCLIB · LIRIK';
    for (const id of ['music-card-line-before', 'music-card-line1', 'music-card-highlight', 'music-card-line2', 'music-card-incoming']) {
      document.getElementById(id)!.textContent = plain
        ? 'Contoh teks biasa yang panjang untuk menguji gulir dan pembungkusan. '.repeat(20)
        : 'Baris contoh panjang untuk menguji pembungkusan pada panel sempit.';
    }
  }, { edge, width, height, plain });
}

async function expectBottomSpace(page: Page, minimum: number) {
  await expect.poll(async () => page.evaluate(() => {
    const card = document.querySelector('#music-lyrics-card')!.getBoundingClientRect();
    const widget = document.querySelector('#dynamic-island')!.getBoundingClientRect();
    return Math.min(widget.bottom, innerHeight) - card.bottom;
  })).toBeGreaterThanOrEqual(minimum);
  const bounds = await page.evaluate(() => {
    const card = document.querySelector('#music-lyrics-card')!.getBoundingClientRect();
    const viewport = document.querySelector('#lyrics-viewport')!.getBoundingClientRect();
    return { height: card.height, inset: card.bottom - viewport.bottom };
  });
  expect(bounds.height).toBeGreaterThan(80);
  expect(bounds.inset).toBeGreaterThanOrEqual(4);
}

for (const dpr of [1, 1.25, 2]) {
  test.describe('DPI ' + dpr, () => {
    test.use({ deviceScaleFactor: dpr });
    test.beforeEach(async ({ page }) => {
      await page.setContent(markup);
      await page.addStyleTag({ content: styles });
      await page.addStyleTag({ content: '@font-face{font-family:"Departure Mono";src:url(data:font/woff2;base64,' + font + ');font-weight:400 700}' });
      await page.evaluate(() => document.fonts.ready);
    });
    for (const edge of ['top', 'bottom', 'floating']) {
      for (const width of [640, 880, 1100]) {
        test(edge + ' ' + width + ' menjaga jarak bawah setelah resize dan pergantian isi', async ({ page }) => {
          await showPanel(page, edge, width, 220);
          await expectBottomSpace(page, 12);
          await showPanel(page, edge, width, 220, true);
          await expectBottomSpace(page, 12);
          await page.locator('#lyrics-viewport').evaluate(el => { el.scrollTop = el.scrollHeight; });
          await expectBottomSpace(page, 12);
        });
      }
    }
    test('perpindahan sisi, atas, bawah, pengaturan dan panel kecil', async ({ page }) => {
      for (const edge of ['left', 'top', 'right', 'bottom', 'floating', 'top']) {
        const side = edge === 'left' || edge === 'right';
        await showPanel(page, edge, side ? 400 : 880, side ? 430 : 220);
        await expectBottomSpace(page, side ? 8 : 12);
        await page.evaluate(() => { document.querySelector('#dynamic-island')!.className = 'island-widget state-compact'; });
        await showPanel(page, edge, side ? 400 : 880, side ? 430 : 220);
        await expectBottomSpace(page, side ? 8 : 12);
        await page.setViewportSize({ width: 960, height: 560 });
        await showPanel(page, edge, side ? 400 : 880, side ? 430 : 220);
        await expectBottomSpace(page, side ? 8 : 12);
      }
    });
  });
}
