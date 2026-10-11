import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs';

const ACTIVITY_URL =
  'https://www.bilibili.com/blackboard/activity-Mz9T5bO5Q3.html?type=dlc&id=104978&lottery_id=105056';

/** 众声漫游夜：行列均无间隙的紧贴型表情包（公共外边距 40px，5×5 满幅格子） */
const GAPLESS_ACTIVITY_URL =
  'https://www.bilibili.com/blackboard/activity-Mz9T5bO5Q3.html?type=dlc&id=114461&lottery_id=114544';

/** 局长的教育手册：同格贴纸相贴（背景/轮廓接触）+ 跨两格的双人格宽贴纸 + 动画道具越出行界 */
const TOUCHING_ACTIVITY_URL =
  'https://www.bilibili.com/blackboard/activity-Mz9T5bO5Q3.html?type=dlc&id=105575&lottery_id=105576';

/** 魔女审判：行内贴纸大面积相贴，接触随动画时断时连（联合 alpha 整行粘连） */
const WITCH_ACTIVITY_URL =
  'https://www.bilibili.com/blackboard/activity-Mz9T5bO5Q3.html?type=dlc&id=111546&lottery_id=111547';

/** 夜奏未终：竖版动态包（3×5 与 5×1 单列两种布局），含飞入文字元素越界 */
const MUJICA_ACTIVITY_URL =
  'https://www.bilibili.com/blackboard/activity-Mz9T5bO5Q3.html?type=dlc&id=107081&lottery_id=107082';

async function parseActivity(page: Page) {
  await page.goto('/');
  await page.fill('#url-input', ACTIVITY_URL);
  await page.getByRole('button', { name: '解析' }).click();
}

/** 解析 GIF 结构：画布尺寸 / 帧数 / 每帧时长（1/100 秒） / 透明标记 */
function parseGifAnim(buf: Buffer) {
  expect(buf.subarray(0, 3).toString()).toBe('GIF');
  const screenW = buf.readUInt16LE(6);
  const screenH = buf.readUInt16LE(8);
  const packed = buf[10];
  let off = 13;
  if (packed & 0x80) off += 3 * (1 << ((packed & 7) + 1)); // 全局色表
  let frames = 0;
  const delays: number[] = [];
  const transparentFlags: boolean[] = [];
  while (off < buf.length) {
    const b = buf[off];
    if (b === 0x3b) break; // trailer
    if (b === 0x21) {
      const label = buf[off + 1];
      off += 2;
      if (label === 0xf9) {
        // Graphic Control Extension：size(1) packed(1) delay(2) index(1) 终止符
        const size = buf[off];
        delays.push(buf.readUInt16LE(off + 2));
        transparentFlags.push((buf[off + 1] & 1) === 1);
        off += 1 + size + 1;
      } else {
        while (off < buf.length) {
          const sz = buf[off];
          off += 1 + sz;
          if (sz === 0) break;
        }
      }
      continue;
    }
    if (b === 0x2c) {
      frames++;
      const lpacked = buf[off + 9];
      off += 10;
      if (lpacked & 0x80) off += 3 * (1 << ((lpacked & 7) + 1)); // 局部色表
      off += 1; // LZW 最小码长
      while (off < buf.length) {
        const sz = buf[off];
        off += 1 + sz;
        if (sz === 0) break;
      }
      continue;
    }
    break; // 未知块
  }
  return { screenW, screenH, frames, delays, transparentFlags };
}

test('解析活动后，全部卡片以全尺寸图正常加载并显示', async ({ page }) => {
  const hdslbFailures: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes('hdslb.com') && !r.ok()) {
      hdslbFailures.push(`${r.status()} ${r.url()}`);
    }
  });

  await parseActivity(page);
  await expect(page.getByText(/卡片列表（\d+）/)).toBeVisible({ timeout: 30_000 });

  const imgs = page.locator('m3e-card img');
  const count = await imgs.count();
  expect(count, '应有图片卡片渲染').toBeGreaterThan(0);
  console.log(`卡片图片数量: ${count}`);

  // 每张图：全尺寸源链、可见、有实际尺寸、成功解码（naturalWidth > 0）
  for (let i = 0; i < count; i++) {
    const img = imgs.nth(i);
    await img.scrollIntoViewIfNeeded(); // 触发 loading="lazy"
    await expect(img).toBeVisible();
    const src = await img.getAttribute('src');
    expect(src, `第 ${i + 1} 张图片应使用全尺寸源链`).toBeTruthy();
    expect(src, `第 ${i + 1} 张图片不应为缩略图后缀`).not.toContain('@300w');
    await expect
      .poll(
        async () => img.evaluate((el) => (el as HTMLImageElement).naturalWidth),
        { timeout: 30_000, message: `第 ${i + 1} 张图片未成功加载` },
      )
      .toBeGreaterThan(0);
    const box = await img.boundingBox();
    expect(box, `第 ${i + 1} 张图片无布局尺寸`).toBeTruthy();
    expect(box!.width).toBeGreaterThan(50);
    expect(box!.height).toBeGreaterThan(50);
  }

  // 素材适配：卡片美术图 cover 满幅、收集品产品图 contain 不裁切
  await expect(imgs.first()).toHaveCSS('object-fit', 'cover');
  const collectImg = page
    .locator('section', { hasText: '收集品列表' })
    .locator('m3e-card img')
    .first();
  await collectImg.scrollIntoViewIfNeeded();
  await expect(collectImg).toHaveCSS('object-fit', 'contain');

  // 所有 hdslb 图片请求均为成功状态（无 403 防盗链 / 404）
  expect(hdslbFailures, '存在失败的图片请求').toEqual([]);

  await page.screenshot({ path: 'e2e-artifacts/gallery-fixed.png', fullPage: true });
});

test('解析过程中按钮显示环形进度条', async ({ page }) => {
  // 延迟 API 代理请求，让解析态持续可见（覆盖截图内部等待字体的耗时）
  await page.route('https://p.xrl.im/**', async (route) => {
    await new Promise((r) => setTimeout(r, 5000));
    await route.continue();
  });

  await parseActivity(page);

  const spinner = page.locator('m3e-button m3e-circular-progress-indicator');
  await expect(spinner).toBeVisible({ timeout: 5_000 });
  // 骨架屏渲染（宿主为 display: contents 无自身盒，直接断言其 shape 的几何）
  const skelOk = await page.evaluate(() => {
    const shape = document
      .querySelector('m3e-skeleton')
      ?.shadowRoot?.querySelector('.shape') as HTMLElement | null;
    if (!shape) return false;
    const r = shape.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  expect(skelOk, '骨架 shape 应有实际几何').toBe(true);
  await page.waitForTimeout(300);
  // 二次确认：解析尚未完成（路由延迟 5s），环形进度应依然可见
  await expect(spinner).toBeVisible();
  await page.screenshot({ path: 'e2e-artifacts/loading-state.png' });

  // 解析完成后按钮恢复文字
  await expect(page.getByText(/卡片列表（\d+）/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: '解析' })).toBeVisible();
});

test('右键菜单不再被拦截（放行浏览器原生菜单）', async ({ page }) => {
  await parseActivity(page);
  await page.waitForSelector('m3e-card', { timeout: 30_000 });

  const prevented = await page.evaluate(() => {
    const target =
      document.querySelector('m3e-card img') ?? document.querySelector('m3e-card');
    if (!target) return true;
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(prevented, 'contextmenu 不应被 preventDefault').toBe(false);
});

test('静态表情包可切割并打包下载 25 张 PNG', async ({ page }) => {
  await parseActivity(page);
  await expect(page.getByText(/收集品列表（\d+）/)).toBeVisible({ timeout: 30_000 });

  // 静态网格 5 行 × 5 列 = 25 张；动态表情包卡片需排除
  const card = page
    .locator('m3e-card')
    .filter({ hasText: '表情包' })
    .filter({ hasNotText: '动态' });
  const emojiBtn = card.getByRole('button', { name: '切割下载表情包' });
  await emojiBtn.scrollIntoViewIfNeeded();

  const downloadPromise = page.waitForEvent('download');
  await emojiBtn.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('表情包');

  const zipPath = 'e2e-artifacts/emoji-pack-static.zip';
  await download.saveAs(zipPath);

  // 解析 ZIP：大图是均匀网格，应切出 25 张尺寸统一的 1:1 方形 PNG
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const names = Object.keys(zip.files);
  expect(names, '5×5 网格应切割为 25 张').toHaveLength(25);

  fs.rmSync('e2e-artifacts/emoji-static', { recursive: true, force: true });
  fs.mkdirSync('e2e-artifacts/emoji-static', { recursive: true });
  const sizes = new Set<string>();
  for (const name of names) {
    const buf = await zip.file(name)!.async('nodebuffer');
    expect(buf.length, '切片不应为空').toBeGreaterThan(100);
    expect(buf.subarray(1, 4).toString()).toBe('PNG');
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    // 每个小表情必须为 1:1 正方形
    expect(w, `切片 ${name} 应为 1:1 正方形`).toBe(h);
    sizes.add(`${w}x${h}`);
    fs.writeFileSync(`e2e-artifacts/emoji-static/${name}`, buf);
    expect(w).toBeLessThanOrEqual(200);
  }
  // 全部切片尺寸统一（均匀网格的格尺寸一致）
  expect(sizes.size, '切片尺寸应统一').toBe(1);
  console.log('静态切片尺寸:', [...sizes].join(','));
});

test('动态表情包可切割并打包下载 20 张动画 GIF', async ({ page }) => {
  await parseActivity(page);
  await expect(page.getByText(/收集品列表（\d+）/)).toBeVisible({ timeout: 30_000 });

  // 动态网格 4 行 × 5 列 = 20 张，每张产物必须保持动态
  const card = page.locator('m3e-card').filter({ hasText: '动态表情包' });
  const emojiBtn = card.getByRole('button', { name: '切割下载表情包' });
  await emojiBtn.scrollIntoViewIfNeeded();

  const downloadPromise = page.waitForEvent('download');
  await emojiBtn.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('表情包');

  const zipPath = 'e2e-artifacts/emoji-pack-dynamic.zip';
  await download.saveAs(zipPath);

  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const names = Object.keys(zip.files);
  expect(names, '4×5 网格应切割为 20 张').toHaveLength(20);

  fs.rmSync('e2e-artifacts/emoji-dynamic', { recursive: true, force: true });
  fs.mkdirSync('e2e-artifacts/emoji-dynamic', { recursive: true });
  for (const name of names) {
    expect(name.endsWith('.gif'), `${name} 应为 GIF 动图`).toBe(true);
    const buf = await zip.file(name)!.async('nodebuffer');
    fs.writeFileSync(`e2e-artifacts/emoji-dynamic/${name}`, buf);

    // GIF 结构：1:1 画布 + 10 帧 + 首帧 15cs / 其余 10cs + 每帧声明透明
    const info = parseGifAnim(buf);
    expect(info.screenW, `${name} 应为 1:1 画布`).toBe(info.screenH);
    expect(info.frames, `${name} 应包含 10 帧`).toBe(10);
    expect(info.delays[0], `${name} 首帧时长`).toBe(15);
    expect(info.delays.slice(1), `${name} 其余帧时长`).toEqual(Array(9).fill(10));
    expect(info.transparentFlags.every(Boolean), `${name} 每帧应声明透明`).toBe(true);

    // 浏览器解码回读：帧数一致，且帧 0/帧 1 像素不同（确为动态）
    const decoded = await page.evaluate(async ({ b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const decoder = new ImageDecoder({ data: bin, type: 'image/gif' });
      await decoder.tracks.ready;
      await decoder.completed;
      const track = decoder.tracks.selectedTrack;
      const n = track.frameCount;
      const durations: number[] = [];
      let diffFirstTwo = 0;
      let first: Uint8ClampedArray | null = null;
      for (let i = 0; i < Math.min(n, 2); i++) {
        const { image } = await decoder.decode({ frameIndex: i });
        durations.push(Math.round((image.duration ?? 0) / 1000));
        const c = new OffscreenCanvas(image.displayWidth, image.displayHeight);
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(image, 0, 0);
        const data = ctx.getImageData(0, 0, c.width, c.height).data;
        image.close();
        if (i === 0) {
          first = data;
        } else {
          for (let p = 0; p < data.length; p += 4) {
            if (
              first![p] !== data[p] || first![p + 1] !== data[p + 1] ||
              first![p + 2] !== data[p + 2] || first![p + 3] !== data[p + 3]
            ) {
              diffFirstTwo++;
            }
          }
        }
      }
      return { n, durations, diffFirstTwo };
    }, { b64: buf.toString('base64') });
    expect(decoded.n, `${name} 解码帧数`).toBe(10);
    expect(decoded.durations[0], `${name} 解码首帧时长`).toBe(150);
    expect(decoded.diffFirstTwo, `${name} 应为动态（前两帧有差异）`).toBeGreaterThan(0);
  }
});

test('紧贴型表情包（行列零间隙）经接缝扫描切割为 25 张 PNG', async ({ page }) => {
  await page.goto('/');
  await page.fill('#url-input', GAPLESS_ACTIVITY_URL);
  await page.getByRole('button', { name: '解析' }).click();
  await expect(page.getByText(/收集品列表（\d+）/)).toBeVisible({ timeout: 30_000 });

  // 众声漫游夜·应援主题表情包：1000×1000 实心内容块，5×5 满幅 200px 格子
  const card = page.locator('m3e-card').filter({ hasText: '应援主题表情包' });
  const emojiBtn = card.getByRole('button', { name: '切割下载表情包' });
  await emojiBtn.scrollIntoViewIfNeeded();

  const downloadPromise = page.waitForEvent('download');
  await emojiBtn.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('表情包');

  const zipPath = 'e2e-artifacts/emoji-pack-gapless.zip';
  await download.saveAs(zipPath);

  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const names = Object.keys(zip.files);
  expect(names, '5×5 紧贴网格应切割为 25 张').toHaveLength(25);

  fs.rmSync('e2e-artifacts/emoji-gapless', { recursive: true, force: true });
  fs.mkdirSync('e2e-artifacts/emoji-gapless', { recursive: true });
  for (const name of names) {
    const buf = await zip.file(name)!.async('nodebuffer');
    expect(buf.subarray(1, 4).toString()).toBe('PNG');
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    expect(w, `${name} 应为 1:1 正方形`).toBe(h);
    // 满幅格子：接缝精确命中时每格恰为内容块的 1/5（200×200）
    expect(w, `${name} 尺寸应贴近 200`).toBeGreaterThanOrEqual(190);
    expect(w, `${name} 尺寸应贴近 200`).toBeLessThanOrEqual(210);
    fs.writeFileSync(`e2e-artifacts/emoji-gapless/${name}`, buf);
  }
});

test('粘连型表情包切割为 20 张：相贴贴纸与跨格宽构图均按格正常裁切', async ({ page }) => {
  await page.goto('/');
  await page.fill('#url-input', TOUCHING_ACTIVITY_URL);
  await page.getByRole('button', { name: '解析' }).click();
  await expect(page.getByText(/收集品列表（\d+）/)).toBeVisible({ timeout: 30_000 });

  // 静态表情包：4 行 × 5 格；首行含双人格横构图（语义 2:1），也必须切成单格 1:1
  const card = page
    .locator('m3e-card')
    .filter({ hasText: '表情包' })
    .filter({ hasNotText: '动态' });
  const emojiBtn = card.getByRole('button', { name: '切割下载表情包' });
  await emojiBtn.scrollIntoViewIfNeeded();

  const downloadPromise = page.waitForEvent('download');
  await emojiBtn.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('表情包');

  const zipPath = 'e2e-artifacts/emoji-pack-touching.zip';
  await download.saveAs(zipPath);

  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const names = Object.keys(zip.files).sort();
  expect(names, '4×5 网格应切割为 20 张').toHaveLength(20);

  fs.rmSync('e2e-artifacts/emoji-touching', { recursive: true, force: true });
  fs.mkdirSync('e2e-artifacts/emoji-touching', { recursive: true });
  const widths: number[] = [];
  for (const name of names) {
    const buf = await zip.file(name)!.async('nodebuffer');
    expect(buf.subarray(1, 4).toString()).toBe('PNG');
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    expect(w, `${name} 应为 1:1 正方形`).toBe(h);
    widths.push(w);
    fs.writeFileSync(`e2e-artifacts/emoji-touching/${name}`, buf);
  }
  // 均匀网格：所有切片尺寸统一（S=200），语义 2:1 的宽构图也按格裁切
  expect(new Set(widths).size, '切片尺寸应统一').toBe(1);
  expect(widths[0], '格尺寸应为一格大小').toBeGreaterThanOrEqual(190);
  expect(widths[0], '格尺寸应为一格大小').toBeLessThanOrEqual(210);
});

test('动态表情包（动画道具越界行间）切割为 20 张动画 GIF', async ({ page }) => {
  await page.goto('/');
  await page.fill('#url-input', TOUCHING_ACTIVITY_URL);
  await page.getByRole('button', { name: '解析' }).click();
  await expect(page.getByText(/收集品列表（\d+）/)).toBeVisible({ timeout: 30_000 });

  // 动画中飞行道具会探出到行间隙（联合 alpha 里形成细碎幻影带），不得把一行错拆成两行
  const card = page.locator('m3e-card').filter({ hasText: '动态表情包' });
  const emojiBtn = card.getByRole('button', { name: '切割下载表情包' });
  await emojiBtn.scrollIntoViewIfNeeded();

  const downloadPromise = page.waitForEvent('download');
  await emojiBtn.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('表情包');

  const zipPath = 'e2e-artifacts/emoji-pack-touching-dynamic.zip';
  await download.saveAs(zipPath);

  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const names = Object.keys(zip.files).sort();
  expect(names, '4×5 网格应切割为 20 张').toHaveLength(20);

  fs.rmSync('e2e-artifacts/emoji-touching-dynamic', { recursive: true, force: true });
  fs.mkdirSync('e2e-artifacts/emoji-touching-dynamic', { recursive: true });
  const gifSizes = new Set<number>();
  for (const name of names) {
    expect(name.endsWith('.gif'), `${name} 应为 GIF 动图`).toBe(true);
    const buf = await zip.file(name)!.async('nodebuffer');
    fs.writeFileSync(`e2e-artifacts/emoji-touching-dynamic/${name}`, buf);

    // GIF 结构：1:1 画布（格子 100px 级，不含幻影带碎条）+ 10 帧 + 首帧 15cs / 其余 10cs
    const info = parseGifAnim(buf);
    expect(info.screenW, `${name} 应为 1:1 画布`).toBe(info.screenH);
    expect(info.screenW, `${name} 不应为碎条（幻影带误拆会切出窄条）`).toBeGreaterThanOrEqual(70);
    expect(info.screenW, `${name} 尺寸不应超出一格`).toBeLessThanOrEqual(110);
    gifSizes.add(info.screenW);
    expect(info.frames, `${name} 应包含 10 帧`).toBe(10);
    expect(info.delays[0], `${name} 首帧时长`).toBe(15);
    expect(info.delays.slice(1), `${name} 其余帧时长`).toEqual(Array(9).fill(10));
    expect(info.transparentFlags.every(Boolean), `${name} 每帧应声明透明`).toBe(true);
  }
  expect(gifSizes.size, '切片尺寸应统一').toBe(1);
});

test('行内大面积粘连的动态表情包按分裂帧恢复格线，切割为 15 张动画 GIF', async ({ page }) => {
  await page.goto('/');
  await page.fill('#url-input', WITCH_ACTIVITY_URL);
  await page.getByRole('button', { name: '解析' }).click();
  await expect(page.getByText(/收集品列表（\d+）/)).toBeVisible({ timeout: 30_000 });

  // 魔女审判：联合 alpha 下行整行粘连（500px 连续带），
  // 但接触随动画时断时连——格线需从各分裂帧的间隙中恢复
  const card = page.locator('m3e-card').filter({ hasText: '动态表情包' });
  const emojiBtn = card.getByRole('button', { name: '切割下载表情包' });
  await emojiBtn.scrollIntoViewIfNeeded();

  const downloadPromise = page.waitForEvent('download');
  await emojiBtn.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('表情包');

  const zipPath = 'e2e-artifacts/emoji-pack-witch-dynamic.zip';
  await download.saveAs(zipPath);

  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const names = Object.keys(zip.files).sort();
  expect(names, '3×5 网格应切割为 15 张').toHaveLength(15);

  fs.rmSync('e2e-artifacts/emoji-witch-dynamic', { recursive: true, force: true });
  fs.mkdirSync('e2e-artifacts/emoji-witch-dynamic', { recursive: true });
  const gifSizes = new Set<number>();
  for (const name of names) {
    expect(name.endsWith('.gif'), `${name} 应为 GIF 动图`).toBe(true);
    const buf = await zip.file(name)!.async('nodebuffer');
    fs.writeFileSync(`e2e-artifacts/emoji-witch-dynamic/${name}`, buf);

    const info = parseGifAnim(buf);
    expect(info.screenW, `${name} 应为 1:1 画布`).toBe(info.screenH);
    expect(info.screenW, `${name} 不应为整行粘连带`).toBeLessThanOrEqual(110);
    gifSizes.add(info.screenW);
    expect(info.frames, `${name} 应包含 10 帧`).toBe(10);
    expect(info.delays[0], `${name} 首帧时长`).toBe(15);
    expect(info.delays.slice(1), `${name} 其余帧时长`).toEqual(Array(9).fill(10));
    expect(info.transparentFlags.every(Boolean), `${name} 每帧应声明透明`).toBe(true);
  }
  expect(gifSizes.size, '切片尺寸应统一').toBe(1);
});

test('竖版动态表情包（3×5 与 5×1）切割为 15 + 5 张统一 GIF', async ({ page }) => {
  await page.goto('/');
  await page.fill('#url-input', MUJICA_ACTIVITY_URL);
  await page.getByRole('button', { name: '解析' }).click();
  await expect(page.getByText(/收集品列表（\d+）/)).toBeVisible({ timeout: 30_000 });

  const cases = [
    { key: 'dyn1', filter: { hasText: '动态表情包', hasNotText: '·' }, count: 15, min: 95, max: 140 },
    { key: 'dyn2', filter: { hasText: '·动态表情包' }, count: 5, min: 190, max: 230 },
  ] as const;

  for (const c of cases) {
    const card = page.locator('m3e-card').filter(c.filter);
    const emojiBtn = card.getByRole('button', { name: '切割下载表情包' });
    await emojiBtn.scrollIntoViewIfNeeded();

    const downloadPromise = page.waitForEvent('download');
    await emojiBtn.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('表情包');

    const zipPath = `e2e-artifacts/emoji-pack-mujica-${c.key}.zip`;
    await download.saveAs(zipPath);

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
    const names = Object.keys(zip.files).sort();
    expect(names, `${c.key} 应切割为 ${c.count} 张`).toHaveLength(c.count);

    const outDir = `e2e-artifacts/emoji-mujica-${c.key}`;
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    const gifSizes = new Set<number>();
    for (const name of names) {
      expect(name.endsWith('.gif'), `${name} 应为 GIF 动图`).toBe(true);
      const buf = await zip.file(name)!.async('nodebuffer');
      fs.writeFileSync(`${outDir}/${name}`, buf);

      // 竖版画布 + 统一格尺寸；动画道具越界不截断内容（槽位以内容边界锚定）
      const info = parseGifAnim(buf);
      expect(info.screenW, `${name} 应为 1:1 画布`).toBe(info.screenH);
      expect(info.screenW, `${name} 尺寸应在格尺寸区间内`).toBeGreaterThanOrEqual(c.min);
      expect(info.screenW, `${name} 尺寸应在格尺寸区间内`).toBeLessThanOrEqual(c.max);
      gifSizes.add(info.screenW);
      expect(info.frames, `${name} 应包含 10 帧`).toBe(10);
      expect(info.delays.every((d) => d === 10), `${name} 每帧时长 10cs`).toBe(true);
      expect(info.transparentFlags.every(Boolean), `${name} 每帧应声明透明`).toBe(true);
    }
    expect(gifSizes.size, '切片尺寸应统一').toBe(1);
  }
});

test('卡片内按钮不撑高卡片（收集品同行等高）', async ({ page }) => {
  await parseActivity(page);
  await expect(page.getByText(/收集品列表（\d+）/)).toBeVisible({ timeout: 30_000 });

  // 收集品区：带按钮卡片（表情/头像）与无按钮卡片（勋章/色纸等）应等高
  const collectCards = page.locator('section', { hasText: '收集品列表' }).locator('m3e-card');
  const count = await collectCards.count();
  expect(count).toBeGreaterThan(1);
  await collectCards.first().scrollIntoViewIfNeeded();
  const heights = await collectCards.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().height),
  );
  const diff = Math.max(...heights) - Math.min(...heights);
  console.log('收集品卡片高度:', heights.join(', '));
  expect(diff, `收集品卡片高度应一致（含带按钮卡片）：${heights.join(',')}`).toBeLessThanOrEqual(1);
});

test('头像框可上传图片、合成圆形头像并下载', async ({ page }) => {
  await parseActivity(page);
  await expect(page.getByText(/收集品列表（\d+）/)).toBeVisible({ timeout: 30_000 });

  // 生成测试头像（渐变 + 白色中心圆，便于肉眼核验圆形裁剪与合成位置）
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 400;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 400, 400);
    g.addColorStop(0, '#7c3aed');
    g.addColorStop(1, '#f59e0b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 400, 400);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(200, 200, 90, 0, Math.PI * 2);
    ctx.fill();
    return c.toDataURL('image/png');
  });
  const testImgPath = 'e2e-artifacts/test-avatar.png';
  fs.writeFileSync(testImgPath, Buffer.from(dataUrl.split(',')[1], 'base64'));

  // 仅「头像框」收集品提供文件输入
  const fileInput = page.locator('input[type=file]');
  await expect(fileInput).toHaveCount(1);

  const downloadPromise = page.waitForEvent('download');
  await fileInput.setInputFiles(testImgPath);
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('头像');

  const outPath = 'e2e-artifacts/embedded-avatar.png';
  await download.saveAs(outPath);

  // 输出应为模板尺寸（420x420）的 PNG
  const buf = fs.readFileSync(outPath);
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  expect(buf.readUInt32BE(16)).toBe(420);
  expect(buf.readUInt32BE(20)).toBe(420);
});
