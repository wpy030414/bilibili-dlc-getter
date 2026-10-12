import type { ParsedUrl } from '../types';

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
