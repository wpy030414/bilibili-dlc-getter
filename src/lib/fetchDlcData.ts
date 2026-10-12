import type { DlcApiResponse, GalleryImage, GallerySection } from '../types';

/** 收集品名称嗅探：决定卡片提供的特殊服务（网格切割 / 头像嵌入） */
function collectService(name: string): GalleryImage['service'] {
  if (name.includes('表情')) return 'emoji';
  if (name.includes('头像框') || name.includes('头像挂件')) return 'pendant';
  return undefined;
}

/** 通过 CORS 代理请求 B 站 DLC 数字周边 API，返回活动标题与分区图片列表 */
export async function fetchDlcData(id: string, lottery_id: string): Promise<{ title: string; sections: GallerySection[] }> {
  const apiUrl = `https://api.bilibili.com/x/vas/dlc_act/lottery/home_detail/v2?act_id=${id}&lottery_id=${lottery_id}`;
  const proxyUrl = `https://p.xrl.im/?url=${encodeURIComponent(apiUrl)}`;

  const response = await fetch(proxyUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const json: DlcApiResponse = await response.json();
  if (json.code !== 0) {
    throw new Error(json.message || `API returned code ${json.code}`);
  }

  const cards: GalleryImage[] = [];
  for (const card of json.data.card_list ?? []) {
    if (card.card_img) {
      cards.push({ name: card.card_name, img: card.card_img, fit: 'cover' });
    }
  }

  const collects: GalleryImage[] = [];
  for (const item of json.data.collect_list ?? []) {
    if (item.redeem_item_image) {
      collects.push({
        name: item.redeem_item_name,
        img: item.redeem_item_image,
        fit: 'contain',
        service: collectService(item.redeem_item_type_name),
      });
    }
  }

  const title = json.data.name || `DLC 活动 (${id})`;
  const sections: GallerySection[] = [];
  if (cards.length) sections.push({ key: 'card', label: '卡片', images: cards, downloadable: true });
  if (collects.length) sections.push({ key: 'collect', label: '收集品', images: collects, downloadable: true });
  return { title, sections };
}
