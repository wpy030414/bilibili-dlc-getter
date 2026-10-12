/** 图库展示用的统一图片条目 */
export interface GalleryImage {
  name: string;
  img: string;
  /** 渲染方式：卡片美术满幅 cover，产品图完整 contain */
  fit: 'cover' | 'contain';
  /** 特殊服务：仅 DLC 收集品设置（表情网格切割 / 头像挂件嵌入），个性装扮不设 */
  service?: 'emoji' | 'pendant';
}

/** 画廊分区：一类图片 + 标题 + 是否可批量下载 */
export interface GallerySection {
  key: string;
  label: string;
  images: GalleryImage[];
  downloadable?: boolean;
}

/** 解析后的链接类型（可辨识联合） */
export type ParsedUrl =
  /** 数字周边：活动链接含显式 lottery_id */
  | { kind: 'dlc'; id: string; lottery_id: string }
  /** 个性装扮：装扮详情页，id 即 item_id */
  | { kind: 'garb'; itemId: string };

/** B 站 DLC 数字周边 API 响应结构 */
export interface DlcApiResponse {
  code: number;
  message: string;
  data: {
    /** 活动名称（用作页面标题） */
    name?: string;
    card_list?: Array<{
      card_name: string;
      card_img: string;
    }>;
    collect_list?: Array<{
      redeem_item_name: string;
      redeem_item_image: string;
      redeem_item_type_name: string;
    }>;
  };
}

/** B 站个性装扮单个条目 */
export interface GarbSuitItem {
  item_id?: number;
  name?: string;
  properties?: Record<string, unknown> | null;
  items?: GarbSuitItem[] | null;
}

/** B 站个性装扮 API 响应结构 */
export interface GarbSuitResponse {
  code: number;
  message: string;
  data: {
    /** 装扮名称（用作页面标题） */
    name?: string;
    /** 分类名 → 条目数组；可能为 null（装扮下架 / 无内容） */
    suit_items?: Record<string, GarbSuitItem[] | null> | null;
  } | null;
}

/** 页面加载状态 */
export type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; title: string; sections: GallerySection[] }
  | { status: 'error'; message: string };
