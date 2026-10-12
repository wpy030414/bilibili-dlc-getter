import type { ParsedUrl } from '../types';

/** Vite base（编译时常量），供路径拼接与反向匹配；末尾带 / */
const BASE = import.meta.env.BASE_URL;

/**
 * 从 Bilibili 链接中提取参数，并区分两类来源：
 * - 含显式 lottery_id（且 id/act_id 存在）→ 数字周边（DLC 活动）
 * - 否则含 id → 个性装扮（id 即 item_id）
 * @returns 解析成功返回 ParsedUrl，失败返回 null
 */
export function parseUrl(input: string): ParsedUrl | null {
  try {
    const url = new URL(input.trim());
    const id = url.searchParams.get('id') || url.searchParams.get('act_id');
    if (!id) return null;

    const lottery_id = url.searchParams.get('lottery_id');
    if (lottery_id) return { kind: 'dlc', id, lottery_id };

    return { kind: 'garb', itemId: id };
  } catch {
    return null;
  }
}

/**
 * 把标准化参数序列化为 RESTful 路径（含 Vite base 前缀）。
 * - dlc → <base>dlc/<id>/<lottery_id>
 * - garb → <base>garb/<itemId>
 */
export function paramsToPath(params: ParsedUrl): string {
  return params.kind === 'dlc'
    ? `${BASE}dlc/${params.id}/${params.lottery_id}`
    : `${BASE}garb/${params.itemId}`;
}

/**
 * 从当前页面 pathname 反向提取标准化参数（RESTful 路径 → ParsedUrl）。
 * 先摘掉 Vite base 前缀，再匹配路由段。
 * @returns 匹配成功返回 ParsedUrl，否则 null
 */
export function paramsFromPathname(): ParsedUrl | null {
  const p = location.pathname;
  // 摘掉 base 前缀（兼容有无末尾 / 的写法）
  const suffix = p.startsWith(BASE)
    ? p.slice(BASE.length).replace(/^\//, '')
    : p.replace(/^\//, '');

  const m = suffix.match(/^dlc\/([^/]+)\/([^/]+)/);
  if (m) return { kind: 'dlc', id: m[1], lottery_id: m[2] };

  const g = suffix.match(/^garb\/([^/]+)/);
  if (g) return { kind: 'garb', itemId: g[1] };

  return null;
}
