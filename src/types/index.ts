/** 图库展示用的统一图片条目 */
export interface GalleryImage {
  name: string;
  img: string;
  /** 来源：卡片列表 或 收集品列表 */
  source: 'card' | 'collect';
}

/** B 站 DLC API 响应结构 */
export interface DlcApiResponse {
  code: number;
  message: string;
  data: {
    card_list?: Array<{
      card_name: string;
      card_img: string;
    }>;
    collect_list?: Array<{
      redeem_item_name: string;
      redeem_item_image: string;
    }>;
  };
}

/** 页面加载状态 */
export type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; images: GalleryImage[] }
  | { status: 'error'; message: string };