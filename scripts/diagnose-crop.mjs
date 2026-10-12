/* 诊断：打开各活动表情卡的切割 dialog，导出推断出的 8 个网格参数与画布尺寸 */
import { chromium } from '@playwright/test';

const ACTIVITIES = [
  ['少女乐队(104978)', 'https://www.bilibili.com/blackboard/activity-Mz9T5bO5Q3.html?type=dlc&id=104978&lottery_id=105056'],
  ['局长手册(105575)', 'https://www.bilibili.com/blackboard/activity-Mz9T5bO5Q3.html?type=dlc&id=105575&lottery_id=105576'],
  ['魔女审判(111546)', 'https://www.bilibili.com/blackboard/activity-Mz9T5bO5Q3.html?type=dlc&id=111546&lottery_id=111547'],
  ['夜奏未终(107081)', 'https://www.bilibili.com/blackboard/activity-Mz9T5bO5Q3.html?type=dlc&id=107081&lottery_id=107082'],
  ['众声漫游(114461)', 'https://www.bilibili.com/blackboard/activity-Mz9T5bO5Q3.html?type=dlc&id=114461&lottery_id=114544'],
];

const LABELS = ['行数', '列数', '上外边距', '下外边距', '左外边距', '右外边距', '行间距', '列间距'];

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto('http://localhost:4173');

for (const [tag, url] of ACTIVITIES) {
  await page.fill('#url-input', url);
  await page.getByRole('button', { name: '解析' }).click();
  await page.locator('m3e-card').first().waitFor({ timeout: 30_000 });

  const cards = page.locator('m3e-card').filter({ has: page.getByRole('button', { name: '切割表情包' }) });
  const n = await cards.count();
  for (let i = 0; i < n; i++) {
    const btn = cards.nth(i).getByRole('button', { name: '切割表情包' });
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    const dialog = page.locator('m3e-dialog[open]');
    await dialog.locator('canvas').waitFor({ timeout: 30_000 });
    const values = await dialog.locator('input').evaluateAll((els) =>
      els.map((el) => `${el.getAttribute('aria-label')}=${el.value}`),
    );
    const dims = await dialog.locator('canvas').evaluate((el) => ({
      w: el.width,
      h: el.height,
    }));
    const cardName = (await cards.nth(i).evaluate((el) => el.textContent)) ?? '';
    console.log(`\n[${tag}] ${cardName.replace(/content_cut[\s\S]*$/, '').trim()}  画布 ${dims.w}x${dims.h}`);
    console.log('  ' + values.join('  '));
    await dialog.getByRole('button', { name: '取消' }).click();
    await page.waitForTimeout(300);
  }
}
await browser.close();
