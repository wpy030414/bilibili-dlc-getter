/**
 * 预览画布通用工具：主题令牌取值、透明底棋盘格。
 * 供表情切割 dialog 与头像合成 dialog 的预览共用（两者都是「透明底 + 叠加绘制」的画布预览）。
 */

/** 从元素上解析主题令牌（M3eTheme 注入），取不到时用 MD3 兜底值 */
export function resolveCssToken(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

/** 透明底棋盘格：两档表面容器色，尺寸随图自适应 */
export function drawCheckerboard(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  light: string,
  dark: string,
) {
  const tile = Math.max(8, Math.round(Math.min(W, H) / 48));
  const p = document.createElement('canvas');
  p.width = tile * 2;
  p.height = tile * 2;
  const pc = p.getContext('2d')!;
  pc.fillStyle = light;
  pc.fillRect(0, 0, tile * 2, tile * 2);
  pc.fillStyle = dark;
  pc.fillRect(0, 0, tile, tile);
  pc.fillRect(tile, tile, tile, tile);
  ctx.fillStyle = ctx.createPattern(p, 'repeat')!;
  ctx.fillRect(0, 0, W, H);
}
