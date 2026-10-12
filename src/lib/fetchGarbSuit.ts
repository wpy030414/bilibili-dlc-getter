import type { GalleryImage, GallerySection, GarbSuitItem, GarbSuitResponse } from '../types';

/** 分类展示顺序与中文标签（主题装扮模式）；未列出的分类回退原始 key，排在末尾 */
const CATEGORY_LABELS: Array<[key: string, label: string]> = [
  ['space_bg', '空间背景'],
  ['skin', '主题皮肤'],
  ['emoji_package', '表情包'],
  ['card', '卡片'],
  ['card_bg', '卡片背景'],
  ['thumbup', '点赞动画'],
  ['loading', '加载动画'],
  ['play_icon', '播放装扮'],
  ['pendant', '头像挂件'],
];

/** 图片 URL 白名单：以此类扩展名结尾（可带 query/hash）才视为图片 */
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|apng)([?#].*)?$/i;

/** 判断属性值是否为图片 URL */
function isImageUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('http') && IMAGE_EXT.test(value);
}

/**
 * 展开一个装扮条目为图片列表：
 * - 顶层：properties 里每个图片字段各出一张，标题用字段名（fieldName）
 * - 子项 items[]（如表情包的子表情）：递归展开，标题用子项自己的 name
 * @param useNameAsLabel true 时用条目 name 作标题（子表情），否则用字段名
 */
function itemImages(item: GarbSuitItem, useNameAsLabel = false): GalleryImage[] {
  const images: GalleryImage[] = [];
  const props = item.properties ?? {};
  const itemName = item.name?.trim();

  for (const [field, value] of Object.entries(props)) {
    if (isImageUrl(value)) {
      const label = useNameAsLabel && itemName ? itemName : field;
      images.push({ name: label, img: value, fit: 'contain' });
    }
  }

  // 递归展开子项（表情包子表情藏在 items[] 里）
  for (const sub of item.items ?? []) {
    images.push(...itemImages(sub, true));
  }

  return images;
}

/** 通过 CORS 代理请求 B 站个性装扮详情 API，返回按分类分区的图片列表 */
export async function fetchGarbSuit(itemId: string): Promise<GallerySection[]> {
  const apiUrl = `https://api.bilibili.com/x/garb/v2/mall/suit/detail?item_id=${itemId}`;
  const proxyUrl = `https://p.xrl.im/?url=${encodeURIComponent(apiUrl)}`;

  const response = await fetch(proxyUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const json: GarbSuitResponse = await response.json();
  if (json.code !== 0) {
    throw new Error(json.message || `API returned code ${json.code}`);
  }

  const suitItems = json.data?.suit_items;
  if (!suitItems) return [];

  // 已知分类按预设顺序输出，未知分类追加在后
  const orderedKeys = [
    ...CATEGORY_LABELS.map(([key]) => key).filter((key) => suitItems[key]),
    ...Object.keys(suitItems).filter((key) => !CATEGORY_LABELS.some(([k]) => k === key)),
  ];

  const sections: GallerySection[] = [];
  for (const key of orderedKeys) {
    const items = suitItems[key] ?? [];
    const images: GalleryImage[] = [];
    for (const item of items) images.push(...itemImages(item));
    if (images.length === 0) continue;
    const label = CATEGORY_LABELS.find(([k]) => k === key)?.[1] ?? key;
    sections.push({ key, label, images, downloadable: true });
  }
  return sections;
}
