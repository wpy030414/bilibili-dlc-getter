import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
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

/** 个性装扮：装扮详情页链接（无 lottery_id，id 即 item_id），走 garb suit detail API */
const GARB_SUIT_URL = 'https://www.bilibili.com/h5/mall/suit/detail?id=67790';

async function parseActivity(page: Page) {
  await page.goto('/');
  await page.fill('#url-input', ACTIVITY_URL);
  await page.getByRole('button', { name: '解析' }).click();
}

/**
 * 切割新流程：点击卡片按钮 → 打开参数 dialog（等待预览画布就绪）→ 点确认 → 下载。
 * emojiBtn 须为卡内按钮定位器（同页多张表情卡，不能全局按名定位）。
 * 返回下载事件；调用方负责 saveAs 与后续断言。
 */
async function confirmCropDownload(page: Page, emojiBtn: Locator) {
  await emojiBtn.click();
  const dialog = page.locator('m3e-dialog[open]');
  await expect(dialog).toBeVisible();
  // 预览画布只在图像解析完成后渲染（loading 态无 canvas）
  await expect(dialog.locator('canvas')).toBeVisible({ timeout: 30_000 });
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '确认切割' }).click();
  return downloadPromise;
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
  await expect(page.getByText(/卡片（\d+）/)).toBeVisible({ timeout: 30_000 });

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
    .locator('section', { hasText: '收集品' })
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
  await expect(page.getByText(/卡片（\d+）/)).toBeVisible({ timeout: 30_000 });
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
  await expect(page.getByText(/收集品（\d+）/)).toBeVisible({ timeout: 30_000 });

  // 静态网格 5 行 × 5 列 = 25 张；动态表情包卡片需排除
  const card = page
    .locator('m3e-card')
    .filter({ hasText: '表情包' })
    .filter({ hasNotText: '动态' });
  const emojiBtn = card.getByRole('button', { name: '切割表情包' });
  await emojiBtn.scrollIntoViewIfNeeded();

  const download = await confirmCropDownload(page, emojiBtn);
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

test('切割 dialog：红色蒙层预览、取消不下载、微调行数后切出对应格数', async ({ page }) => {
  await parseActivity(page);
  await expect(page.getByText(/收集品（\d+）/)).toBeVisible({ timeout: 30_000 });

  const card = page
    .locator('m3e-card')
    .filter({ hasText: '表情包' })
    .filter({ hasNotText: '动态' });
  const emojiBtn = card.getByRole('button', { name: '切割表情包' });
  await emojiBtn.scrollIntoViewIfNeeded();
  await emojiBtn.click();

  const dialog = page.locator('m3e-dialog[open]');
  await expect(dialog).toBeVisible();
  const canvas = dialog.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 30_000 });

  // 8 个参数输入框：行、列、四边外边距、行、列间距
  await expect(dialog.locator('input')).toHaveCount(8);

  // 预览已绘制：源图 + 红色蒙层贡献非透明像素，且存在「红显著大于绿」的蒙层像素
  const stats = await canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let opaque = 0;
    let reddish = 0;
    for (let p = 0; p < d.length; p += 4) {
      if (d[p + 3] > 0) opaque++;
      if (d[p + 3] > 0 && d[p] - d[p + 1] > 40) reddish++;
    }
    return { opaque, reddish };
  });
  expect(stats.opaque, '预览画布不应空白').toBeGreaterThan(0);
  expect(stats.reddish, '被裁掉区域应有红色蒙层').toBeGreaterThan(0);
  await page.screenshot({ path: 'e2e-artifacts/crop-dialog.png' });

  // 背景点击 / ESC 均不得关闭（仅「取消」与确认完成可关）
  await page.mouse.click(8, 8);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();

  // 取消：dialog 关闭且不触发下载
  let downloaded = false;
  page.once('download', () => {
    downloaded = true;
  });
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).not.toBeVisible();
  await page.waitForTimeout(500);
  expect(downloaded, '取消不应触发下载').toBe(false);

  // 重新打开（保留微调状态），行数 5 → 6，确认后切出 30 格
  await emojiBtn.click();
  await expect(page.locator('m3e-dialog[open]')).toBeVisible();
  await expect(canvas).toBeVisible();
  await dialog.locator('input').first().fill('6'); // 第一个字段 = 行数

  // dialog 显示的「格 W×H px」= 真实裁切窗（宽=列格、高=行格，可非方）；
  // 「（1:1）」标识只在 W===H 时出现，且必须与算出的 W、H 严格一致（不硬写）
  const infoText = await dialog.locator('.crop-info').innerText();
  const cellMatch = infoText.match(/格 (\d+)×(\d+) px(（1:1）)?/);
  expect(cellMatch, `「格」应显示为整数 W×H：${infoText}`).not.toBeNull();
  const shownW = Number(cellMatch![1]);
  const shownH = Number(cellMatch![2]);
  expect(cellMatch![3] === '（1:1）', `「（1:1）」标识应与 W===H 一致：${infoText}`).toBe(
    shownW === shownH,
  );
  // 裁切窗补成 1:1 方形后产物边长 = max(窗宽, 窗高)
  const productSide = Math.max(shownW, shownH);

  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '确认切割' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('表情包');

  const zipPath = 'e2e-artifacts/emoji-pack-dialog-tuned.zip';
  await download.saveAs(zipPath);
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const tunedNames = Object.keys(zip.files);
  expect(tunedNames, '6 行 × 5 列应切割为 30 张').toHaveLength(30);

  // 产物几何：微调致除不尽时，30 张切片仍为统一整数 1:1 方片，
  // 且边长 = max(裁切窗宽, 高)（与 dialog 显示的 W×H 同源）
  const tunedSizes = new Set<string>();
  for (const n of tunedNames) {
    const buf = await zip.file(n)!.async('nodebuffer');
    expect(buf.subarray(1, 4).toString()).toBe('PNG');
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    expect(w, `${n} 产物应为 1:1 正方形`).toBe(h);
    expect(Number.isInteger(w), `${n} 尺寸应为整数`).toBe(true);
    expect(w, `${n} 产物边长应等于 max(裁切窗宽,高)=${productSide}`).toBe(productSide);
    tunedSizes.add(`${w}x${h}`);
  }
  expect(tunedSizes.size, '微调后切片尺寸应统一').toBe(1);
  console.log('微调切片尺寸:', [...tunedSizes].join(','));

  // 「（1:1）」标识诚实性：把行数改成明显不等的高度（2），裁切窗变非方，
  // 标识必须如实取消，且如实显示 W≠H
  await emojiBtn.click();
  await expect(page.locator('m3e-dialog[open]')).toBeVisible();
  await dialog.locator('input').first().fill('2');
  const info2 = await dialog.locator('.crop-info').innerText();
  const m2 = info2.match(/格 (\d+)×(\d+) px(（1:1）)?/);
  expect(m2, `「格」应显示为整数 W×H：${info2}`).not.toBeNull();
  expect(Number(m2![1]), `行数改 2 后应为非方裁切窗 W≠H：${info2}`).not.toBe(Number(m2![2]));
  expect(m2![3], '非 1:1 时不得标注「（1:1）」').toBeUndefined();
  await dialog.getByRole('button', { name: '取消' }).click();
});

test('贴纸紧贴的满幅表：列间距如实推断为 0，裁切窗为正 1:1（回归 id=112538）', async ({ page }) => {
  await page.goto('/');
  await page.fill(
    '#url-input',
    'https://www.bilibili.com/blackboard/activity-Mz9T5bO5Q3.html?type=dlc&id=112538&lottery_id=112539',
  );
  await page.getByRole('button', { name: '解析' }).click();
  await expect(page.getByText(/收集品（\d+）/)).toBeVisible({ timeout: 30_000 });

  const card = page.locator('m3e-card').filter({ hasText: '表情包' }).filter({ hasNotText: '动态' });
  const emojiBtn = card.getByRole('button', { name: '切割表情包' });
  await emojiBtn.scrollIntoViewIfNeeded();
  await emojiBtn.click();

  const dialog = page.locator('m3e-dialog[open]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('canvas')).toBeVisible({ timeout: 30_000 });

  // 人眼应得的干净解：上下边距 56、左右边距 40、列间距 0 → 格 200×200（1:1）。
  // 此前被「内容带中心差」累积的 ±1px 噪声算成 55/53、38/37 → 201（非方）。
  const val = (label: string) => dialog.locator(`input[aria-label="${label}"]`).inputValue();
  expect(await val('行间距'), '行间距应为 56').toBe('56');
  expect(await val('列间距'), '贴纸紧贴应推断为 0（1px 缝隙是噪声）').toBe('0');
  expect(await val('上边距'), '上边距应为 56').toBe('56');
  expect(await val('下边距'), '下边距应为 56').toBe('56');
  expect(await val('左边距'), '左边距应为 40').toBe('40');
  expect(await val('右边距'), '右边距应为 40').toBe('40');

  const info = await dialog.locator('.crop-info').innerText();
  expect(info, '应显示 200×200 正 1:1').toContain('格 200×200 px（1:1）');

  await dialog.getByRole('button', { name: '取消' }).click();
});

test('动态表情包可切割并打包下载 20 张动画 GIF', async ({ page }) => {
  await parseActivity(page);
  await expect(page.getByText(/收集品（\d+）/)).toBeVisible({ timeout: 30_000 });

  // 动态网格 4 行 × 5 列 = 20 张，每张产物必须保持动态
  const card = page.locator('m3e-card').filter({ hasText: '动态表情包' });
  const emojiBtn = card.getByRole('button', { name: '切割表情包' });
  await emojiBtn.scrollIntoViewIfNeeded();

  const download = await confirmCropDownload(page, emojiBtn);
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
  await expect(page.getByText(/收集品（\d+）/)).toBeVisible({ timeout: 30_000 });

  // 众声漫游夜·应援主题表情包：1000×1000 实心内容块，5×5 满幅 200px 格子
  const card = page.locator('m3e-card').filter({ hasText: '应援主题表情包' });
  const emojiBtn = card.getByRole('button', { name: '切割表情包' });
  await emojiBtn.scrollIntoViewIfNeeded();

  const download = await confirmCropDownload(page, emojiBtn);
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
  await expect(page.getByText(/收集品（\d+）/)).toBeVisible({ timeout: 30_000 });

  // 静态表情包：4 行 × 5 格；首行含双人格横构图（语义 2:1），也必须切成单格 1:1
  const card = page
    .locator('m3e-card')
    .filter({ hasText: '表情包' })
    .filter({ hasNotText: '动态' });
  const emojiBtn = card.getByRole('button', { name: '切割表情包' });
  await emojiBtn.scrollIntoViewIfNeeded();

  const download = await confirmCropDownload(page, emojiBtn);
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
  await expect(page.getByText(/收集品（\d+）/)).toBeVisible({ timeout: 30_000 });

  // 动画中飞行道具会探出到行间隙（联合 alpha 里形成细碎幻影带），不得把一行错拆成两行
  const card = page.locator('m3e-card').filter({ hasText: '动态表情包' });
  const emojiBtn = card.getByRole('button', { name: '切割表情包' });
  await emojiBtn.scrollIntoViewIfNeeded();

  const download = await confirmCropDownload(page, emojiBtn);
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
  await expect(page.getByText(/收集品（\d+）/)).toBeVisible({ timeout: 30_000 });

  // 魔女审判：联合 alpha 下行整行粘连（500px 连续带），
  // 但接触随动画时断时连——格线需从各分裂帧的间隙中恢复
  const card = page.locator('m3e-card').filter({ hasText: '动态表情包' });
  const emojiBtn = card.getByRole('button', { name: '切割表情包' });
  await emojiBtn.scrollIntoViewIfNeeded();

  const download = await confirmCropDownload(page, emojiBtn);
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
  await expect(page.getByText(/收集品（\d+）/)).toBeVisible({ timeout: 30_000 });

  const cases = [
    { key: 'dyn1', filter: { hasText: '动态表情包', hasNotText: '·' }, count: 15, min: 95, max: 140 },
    { key: 'dyn2', filter: { hasText: '·动态表情包' }, count: 5, min: 190, max: 230 },
  ] as const;

  for (const c of cases) {
    const card = page.locator('m3e-card').filter(c.filter);
    const emojiBtn = card.getByRole('button', { name: '切割表情包' });
    await emojiBtn.scrollIntoViewIfNeeded();

    const download = await confirmCropDownload(page, emojiBtn);
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
  await expect(page.getByText(/收集品（\d+）/)).toBeVisible({ timeout: 30_000 });

  // 收集品区：带按钮卡片（表情/头像）与无按钮卡片（勋章/色纸等）应等高
  const collectCards = page.locator('section', { hasText: '收集品' }).locator('m3e-card');
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

test('头像框：上传图片后弹合成 dialog，预览可调半径，确认后按半径下载', async ({ page }) => {
  await parseActivity(page);
  await expect(page.getByText(/收集品（\d+）/)).toBeVisible({ timeout: 30_000 });

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

  // 选文件 → 弹出合成 dialog（不是直接下载）
  await fileInput.setInputFiles(testImgPath);
  const dialog = page.locator('m3e-dialog[open]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('canvas')).toBeVisible({ timeout: 30_000 }); // 预览就绪

  // 半径默认值来自模板圆孔自动推断（正数），且 dialog 如实回报模板尺寸
  const radiusInput = dialog.locator('input[aria-label="头像半径"]');
  await expect(radiusInput).toBeVisible();
  const defaultRadius = Number(await radiusInput.inputValue());
  expect(defaultRadius, '头像半径应自动推断为正整数').toBeGreaterThan(1);
  await expect(dialog.locator('.crop-info')).toContainText(`头像半径 ${defaultRadius} px`);
  await expect(dialog.locator('.crop-info')).toContainText('模板 420×420 px');
  await page.screenshot({ path: 'e2e-artifacts/avatar-dialog.png' });

  // 背景点击 / ESC 均不得关闭（仅「取消」与确认完成可关）
  await page.mouse.click(8, 8);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();

  // 按默认半径确认：产物为模板尺寸（420×420）的 PNG
  const downloadA = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '确认合成' }).click();
  const dlA = await downloadA;
  expect(dlA.suggestedFilename()).toContain('头像');
  const outA = 'e2e-artifacts/embedded-avatar.png';
  await dlA.saveAs(outA);
  const bufA = fs.readFileSync(outA);
  expect(bufA.subarray(1, 4).toString()).toBe('PNG');
  expect(bufA.readUInt32BE(16)).toBe(420);
  expect(bufA.readUInt32BE(20)).toBe(420);

  // 重新选取同一文件 → dialog 再次打开；把半径改小后确认，
  // 产物像素必须随之改变（半径确实作用到合成结果，而非写死）
  await fileInput.setInputFiles(testImgPath);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('canvas')).toBeVisible({ timeout: 30_000 });
  const smaller = Math.max(1, defaultRadius - 60);
  await radiusInput.fill(String(smaller));
  await expect(dialog.locator('.crop-info')).toContainText(`头像半径 ${smaller} px`);
  await page.waitForTimeout(400); // 等 dialog 开启动画落定再截图
  await page.screenshot({ path: 'e2e-artifacts/avatar-dialog-narrow.png' });

  const downloadB = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '确认合成' }).click();
  const dlB = await downloadB;
  const outB = 'e2e-artifacts/embedded-avatar-narrow.png';
  await dlB.saveAs(outB);
  const bufB = fs.readFileSync(outB);
  expect(bufB.readUInt32BE(16)).toBe(420);
  expect(bufB.readUInt32BE(20)).toBe(420);
  expect(bufB.equals(bufA), '改小半径后的产物应与默认半径不同（半径确有生效）').toBe(false);

  // 取消：dialog 关闭且不触发下载
  await fileInput.setInputFiles(testImgPath);
  await expect(dialog).toBeVisible();
  let downloaded = false;
  page.once('download', () => {
    downloaded = true;
  });
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).not.toBeVisible();
  await page.waitForTimeout(500);
  expect(downloaded, '取消不应触发下载').toBe(false);
});

test('个性装扮链接：按分类分区展示全部图片字段', async ({ page }) => {
  const hdslbFailures: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes('hdslb.com') && !r.ok()) {
      hdslbFailures.push(`${r.status()} ${r.url()}`);
    }
  });

  await page.goto('/');
  await page.fill('#url-input', GARB_SUIT_URL);
  await page.getByRole('button', { name: '解析' }).click();

  // 装扮详情应出现「卡片」分区（该装扮含 card / card_bg / emoji_package / skin / space_bg 等）
  await expect(page.getByText(/卡片（\d+）/)).toBeVisible({ timeout: 30_000 });
  // 分类分区标题：主题皮肤 / 空间背景 等均应作为独立 section 出现
  await expect(page.getByText(/主题皮肤（\d+）/)).toBeVisible();
  await expect(page.getByText(/空间背景（\d+）/)).toBeVisible();

  // 分类顺序：空间背景 → 主题皮肤 → 表情包 → 卡片 → 卡片背景
  const sectionLabels = await page.locator('section > div > m3e-heading').allInnerTexts();
  const order = sectionLabels.map((t) => t.replace(/（\d+）/, '').trim());
  console.log('分区顺序:', order.join(' → '));
  expect(order).toEqual(['空间背景', '主题皮肤', '表情包', '卡片', '卡片背景']);

  // 表情包应展开全部子表情（该装扮为 1 封面 + 19 子表情 = 20），而非仅封面一张
  const emojiCount = Number(
    (sectionLabels.find((t) => t.startsWith('表情包')) ?? '').match(/（(\d+)）/)?.[1] ?? '0',
  );
  expect(emojiCount, '表情包应展开子表情').toBeGreaterThan(1);
  console.log(`表情包图片数量: ${emojiCount}`);

  const imgs = page.locator('m3e-card img');
  const count = await imgs.count();
  expect(count, '应有装扮图片渲染').toBeGreaterThan(0);
  console.log(`个性装扮图片数量: ${count}`);

  // 抽查前若干张：src 指向 hdslb CDN 且为图片扩展名（非 .zip/.mp4/.json/.bin）
  const sample = Math.min(count, 12);
  for (let i = 0; i < sample; i++) {
    const img = imgs.nth(i);
    await img.scrollIntoViewIfNeeded();
    const src = await img.getAttribute('src');
    expect(src, `第 ${i + 1} 张图片应有源链`).toBeTruthy();
    expect(src, `第 ${i + 1} 张图片应来自 hdslb CDN`).toContain('hdslb.com');
    expect(src, `第 ${i + 1} 张图片应为图片扩展名`).toMatch(/\.(png|jpe?g|webp|gif|apng)([?#].*)?$/i);
    await expect
      .poll(async () => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), {
        timeout: 30_000,
        message: `第 ${i + 1} 张图片未成功加载`,
      })
      .toBeGreaterThan(0);
  }

  // 个性装扮产品图统一 contain 完整展示
  await expect(imgs.first()).toHaveCSS('object-fit', 'contain');

  expect(hdslbFailures, '存在失败的图片请求').toEqual([]);
  await page.screenshot({ path: 'e2e-artifacts/garb-suit.png', fullPage: true });
});

test('个性装扮链接：无 lottery_id 不误判为格式错误', async ({ page }) => {
  await page.goto('/');
  await page.fill('#url-input', GARB_SUIT_URL);
  await page.getByRole('button', { name: '解析' }).click();

  // 不应出现「无法从链接中提取」的解析失败文案
  await expect(page.getByText(/无法从链接中提取/)).toHaveCount(0);
  // 应进入成功或（若装扮下架）业务空态，而非解析错误
  await expect(page.getByText(/卡片（\d+）|未找到任何图片数据/).first()).toBeVisible({
    timeout: 30_000,
  });
});
