/**
 * 从 Bilibili 活动页 URL 中提取 id 和 lottery_id
 * @returns 解析成功返回参数对象，失败返回 null
 */
export function parseUrl(input: string): { id: string; lottery_id: string } | null {
  try {
    const url = new URL(input.trim());
    const id = url.searchParams.get('id');
    const lottery_id = url.searchParams.get('lottery_id');
    if (!id || !lottery_id) return null;
    return { id, lottery_id };
  } catch {
    return null;
  }
}