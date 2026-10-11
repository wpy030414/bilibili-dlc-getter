import type { DlcApiResponse, GalleryImage } from '../types';

/** 通过 CORS 代理请求 B 站 DLC API，返回统一图片列表 */
export async function fetchDlcData(id: string, lottery_id: string): Promise<GalleryImage[]> {
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

  const images: GalleryImage[] = [];

  for (const card of json.data.card_list ?? []) {
    if (card.card_img) {
      images.push({ name: card.card_name, img: card.card_img, source: 'card' });
    }
  }
  for (const item of json.data.collect_list ?? []) {
    if (item.redeem_item_image) {
      images.push({ name: item.redeem_item_name, img: item.redeem_item_image, source: 'collect' });
    }
  }

  return images;
}