/**
 * 表情包网格分析：从像素实时推断网格结构，输出统一尺寸的每格裁切窗口。
 * 纯计算模块（无 DOM 依赖），供 imageProcessing 调用，也可在 Node 中直接测试。
 *
 * 网格裁切不允许窗口相交：全部切片同尺寸 1:1、各自容纳本格内容、
 * 相邻窗口零交集（内容范围与格距冲突时，窗口取「区间链」解出的最大
 * 可行尺寸并滑入邻格空白，而非把邻格内容带进来）。
 *
 * 算法分层：
 * - 常规层：行轴按 alpha 内容带分段（幻影带并回邻居）；列数由全部帧、
 *   全部行的「内容间隙中点」拟合周期判定——动画里贴纸接触时断时连，
 *   联合 alpha 上整行粘连的图能在分裂帧里恢复格线。
 * - 兜底层：内容满幅且完全无间隙（紧贴型网格）时没有内容边界可依，
 *   用接缝颜色剖面数出行列数。
 */

export const ALPHA_THRESHOLD = 10;

export type Band = [number, number];

/** 单元裁切窗口（统一尺寸 1:1 方片在原图中的位置） */
export interface CellBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface GridInput {
  /** 主图像素（静态图本身 / 动图首帧），供接缝颜色分析 */
  rgba: Uint8ClampedArray;
  /** alpha 图组：第 0 张为主图（静态图 alpha / 动图全帧联合 alpha），动图时其后为各帧 */
  alphas: Uint8ClampedArray[];
  W: number;
  H: number;
}

/** 一维投影中的「内容带」：连续非零区间 */
export function contentBands(projection: number[]): Band[] {
  const bands: Band[] = [];
  let start: number | null = null;
  for (let i = 0; i < projection.length; i++) {
    if (projection[i] > 0) {
      if (start === null) start = i;
    } else if (start !== null) {
      bands.push([start, i - 1]);
      start = null;
    }
  }
  if (start !== null) bands.push([start, projection.length - 1]);
  return bands;
}

/** 区域内按行 / 列的 alpha 内容投影（alpha 为逐像素不透明度，宽度 * 高度） */
export function projectAlpha(
  alpha: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  axis: 'row' | 'col',
): number[] {
  const length = axis === 'row' ? y1 - y0 + 1 : x1 - x0 + 1;
  const proj = new Array<number>(length).fill(0);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (alpha[y * width + x] > ALPHA_THRESHOLD) {
        if (axis === 'row') proj[y - y0]++;
        else proj[x - x0]++;
      }
    }
  }
  return proj;
}

/** 区域内 alpha 内容的包围盒 */
export function alphaBox(
  alpha: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): CellBox | null {
  let minX = x1;
  let minY = y1;
  let maxX = -1;
  let maxY = -1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (alpha[y * width + x] > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

/* ---------------- 通用小工具 ---------------- */

function lowerMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1];
}

/**
 * 幻影带合并：远小于常规尺寸且紧贴相邻带的碎带（如动画中的飞行道具
 * 探出到行间形成的细带）并回最近的邻居，避免把一行错拆成两行。
 */
export function mergePhantoms(bands: Band[]): Band[] {
  if (bands.length < 2) return bands.map((b) => [...b] as Band);
  const med = lowerMedian(bands.map(([a, b]) => b - a + 1));
  const gapLimit = med * 0.35;
  const out: Band[] = [];
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i];
    const size = band[1] - band[0] + 1;
    if (size < med * 0.35) {
      const prev = out[out.length - 1];
      const gapPrev = prev ? band[0] - prev[1] - 1 : Infinity;
      const gapNext = i + 1 < bands.length ? bands[i + 1][0] - band[1] - 1 : Infinity;
      if (gapPrev < gapNext && gapPrev < gapLimit) {
        prev[1] = Math.max(prev[1], band[1]);
        continue;
      }
      if (gapNext < gapLimit) {
        bands[i + 1] = [Math.min(bands[i + 1][0], band[0]), bands[i + 1][1]];
        continue;
      }
    }
    out.push([band[0], band[1]]);
  }
  return out;
}

/**
 * 统一格子拟合：对汇聚的「间隙中点」做周期搜索。
 * 对候选周期 p 检视所有中点落到 [0, p) 后的相位集中度（圆均值），
 * 并要求内容跨度 ~ 格数 × p（外圈内容贴边的排版里跨度即整格）。
 * 相位集中度相近时偏好更大周期（避免因子谐波把双倍格宽误当一格）。
 */
export function estimateLattice(
  midpoints: number[],
  lo: number,
  hi: number,
): { pitch: number; offset: number } | null {
  if (midpoints.length < 2) return null;
  const span = hi - lo + 1;
  const candidates: Array<{ pitch: number; offset: number; conc: number }> = [];
  const pMin = Math.max(24, Math.ceil(span / 12));
  const pMax = Math.floor(span / 2);
  for (let p = pMin; p <= pMax; p++) {
    const n = Math.round(span / p);
    if (n < 2 || n > 12) continue;
    if (Math.abs(span - n * p) > p * 0.3) continue;
    let sx = 0;
    let sy = 0;
    for (const m of midpoints) {
      const phase = ((m % p) + p) % p;
      const theta = (2 * Math.PI * phase) / p;
      sx += Math.cos(theta);
      sy += Math.sin(theta);
    }
    const conc = Math.hypot(sx, sy) / midpoints.length;
    const phase = (Math.atan2(sy, sx) / (2 * Math.PI)) * p;
    candidates.push({ pitch: p, offset: ((phase % p) + p) % p, conc });
  }
  if (candidates.length === 0) return null;
  const bestConc = Math.max(...candidates.map((c) => c.conc));
  if (bestConc < 0.5) return null;
  /**
   * 三个判据从粗到细决胜：
   * 1. 覆盖率——内部格线应条条有中点佐证（因子谐波会引入大量无佐证的
   *    中间格线，真实周期不会）；
   * 2. 截断残差——中点到最近格线距离之和（截断 8px 抑制偏置离群点）；
   * 3. 完全平局（半周期谐波）取更大周期。
   */
  const coverage = (c: { pitch: number; offset: number }): number => {
    const interior: number[] = [];
    const kLo = Math.ceil((0 - c.offset) / c.pitch);
    for (let k = kLo; ; k++) {
      const line = c.offset + k * c.pitch;
      if (line < 0) continue;
      if (line > span) break;
      if (line > c.pitch * 0.2 && line < span - c.pitch * 0.2) interior.push(line);
    }
    if (interior.length === 0) return 0;
    const tol = c.pitch * 0.15;
    let hit = 0;
    for (const line of interior) {
      if (midpoints.some((m) => Math.abs(m - line) <= tol)) hit++;
    }
    return hit / interior.length;
  };
  const cappedResidual = (c: { pitch: number; offset: number }): number => {
    let sum = 0;
    for (const m of midpoints) {
      const k = Math.round((m - c.offset) / c.pitch);
      sum += Math.min(8, Math.abs(m - (c.offset + k * c.pitch)));
    }
    return sum;
  };
  const near = candidates.filter((c) => c.conc >= bestConc - 0.05);
  const chosen = near.reduce((a, b) => {
    const ca = coverage(a);
    const cb = coverage(b);
    if (cb > ca + 1e-9) return b;
    if (ca > cb + 1e-9) return a;
    const ra = cappedResidual(a);
    const rb = cappedResidual(b);
    if (rb < ra - 1e-9) return b;
    if (ra < rb - 1e-9) return a;
    return b.pitch > a.pitch ? b : a;
  });
  return { pitch: chosen.pitch, offset: chosen.offset };
}

/* ---------------- 接缝颜色剖面（满幅兜底层） ---------------- */

/**
 * 接缝剖面：相邻列 / 行之间的颜色差，沿垂直方向取中位数。
 * 完全无间隙的网格里没有空白可依据，但真实接缝处两格图像不同、
 * 整条剖面的色差都很大；格子内部只有内容边缘的局部色差——中位数聚合后
 * 两者相差一个数量级，足以定位接缝。两侧都透明的配对不参与统计。
 */
export function seamProfile(
  rgba: Uint8ClampedArray,
  alpha: Uint8ClampedArray,
  W: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  axis: 'row' | 'col',
): Float64Array {
  const count = axis === 'col' ? x1 - x0 : y1 - y0;
  const prof = new Float64Array(Math.max(0, count));
  for (let i = 0; i < count; i++) {
    const diffs: number[] = [];
    if (axis === 'col') {
      const xa = x0 + i;
      const xb = xa + 1;
      for (let y = y0; y <= y1; y++) {
        const ia = y * W + xa;
        const ib = y * W + xb;
        if (alpha[ia] <= ALPHA_THRESHOLD && alpha[ib] <= ALPHA_THRESHOLD) continue;
        const pa = ia * 4;
        const pb = ib * 4;
        diffs.push(
          Math.abs(rgba[pa] - rgba[pb]) +
            Math.abs(rgba[pa + 1] - rgba[pb + 1]) +
            Math.abs(rgba[pa + 2] - rgba[pb + 2]),
        );
      }
    } else {
      const ya = y0 + i;
      const yb = ya + 1;
      for (let x = x0; x <= x1; x++) {
        const ia = ya * W + x;
        const ib = yb * W + x;
        if (alpha[ia] <= ALPHA_THRESHOLD && alpha[ib] <= ALPHA_THRESHOLD) continue;
        const pa = ia * 4;
        const pb = ib * 4;
        diffs.push(
          Math.abs(rgba[pa] - rgba[pb]) +
            Math.abs(rgba[pa + 1] - rgba[pb + 1]) +
            Math.abs(rgba[pa + 2] - rgba[pb + 2]),
        );
      }
    }
    diffs.sort((a, b) => a - b);
    prof[i] = diffs.length ? diffs[diffs.length >> 1] : 0;
  }
  return prof;
}

/**
 * 接缝扫描（满幅兜底层）：公共外边距确定内容块后，对候选段数 N（2..10）
 * 做扫描——边界吸附到理想等分位附近的剖面局部最大，取「边界处剖面强度
 * 均值 / 整体均值」（对比度）最高的 N 作为段数，返回吸附到真实接缝的切割
 * 位置（[起点, 各分割点, 终点+1] 递增序列）。
 */
export function seamCuts(
  rgba: Uint8ClampedArray,
  alpha: Uint8ClampedArray,
  W: number,
  H: number,
  axis: 'row' | 'col',
): number[] {
  const cross = axis === 'col' ? 'row' : 'col';
  const mainBands = contentBands(projectAlpha(alpha, W, 0, 0, W - 1, H - 1, axis));
  const crossBands = contentBands(projectAlpha(alpha, W, 0, 0, W - 1, H - 1, cross));
  if (mainBands.length === 0 || crossBands.length === 0) return [];
  const lo = mainBands[0][0];
  const hi = mainBands[mainBands.length - 1][1];

  const x0 = axis === 'col' ? lo : crossBands[0][0];
  const x1 = axis === 'col' ? hi : crossBands[crossBands.length - 1][1];
  const y0 = axis === 'col' ? crossBands[0][0] : lo;
  const y1 = axis === 'col' ? crossBands[crossBands.length - 1][1] : hi;

  const prof = seamProfile(rgba, alpha, W, x0, y0, x1, y1, axis);
  if (prof.length === 0) return [];
  const span = hi - lo + 1;
  const overall = prof.reduce((s, v) => s + v, 0) / prof.length || 1;

  const snap = (ideal: number): number => {
    let best = ideal;
    let bestV = -1;
    const from = Math.max(x0, ideal - 4);
    const to = Math.min(x0 + prof.length - 1, ideal + 4);
    for (let p = from; p <= to; p++) {
      if (prof[p - x0] > bestV) {
        bestV = prof[p - x0];
        best = p;
      }
    }
    return best;
  };

  let bestCuts: number[] = [];
  let bestContrast = -1;
  for (let N = 2; N <= 10; N++) {
    let sum = 0;
    const cuts: number[] = [lo];
    for (let i = 1; i < N; i++) {
      const at = snap(lo + Math.round((span * i) / N));
      sum += prof[at - x0];
      cuts.push(at + 1);
    }
    cuts.push(hi + 1);
    const contrast = sum / (N - 1) / overall;
    if (contrast > bestContrast) {
      bestContrast = contrast;
      bestCuts = cuts;
    }
  }
  return bestCuts.length > 2 ? bestCuts : [lo, hi + 1];
}

/** 单轴某槽位的内容范围（含首末） */
type Extent = [number, number];

/**
 * 区间链可行性：窗口同宽 S、各自容纳自身内容 [a,b]、且相邻窗口零交集。
 * 从左贪心取最早可行起点 w_k = max(b_k − S + 1, w_{k−1} + S)，
 * 全部 w_k ≤ a_k 即有严格不重叠的窗口序列（窗口允许越出画布，越界为透明补边）。
 */
function chainFeasible(extents: Extent[], S: number): boolean {
  let prev = -Infinity;
  for (const [a, b] of extents) {
    const w = prev === -Infinity ? b - S + 1 : Math.max(b - S + 1, prev + S);
    if (w > a) return false;
    prev = w;
  }
  return true;
}

/**
 * 各窗口起点（前提：chainFeasible 通过）：先贪心求最早可行序列，
 * 再在不破坏链（不超过下一窗口最早起点、且容纳自身内容）的余量内让内容居中。
 */
function chainStarts(extents: Extent[], S: number): number[] {
  const greedy: number[] = [];
  let prev = -Infinity;
  for (const [, b] of extents) {
    const w = prev === -Infinity ? b - S + 1 : Math.max(b - S + 1, prev + S);
    greedy.push(w);
    prev = w;
  }
  return extents.map(([a, b], k) => {
    const lo = greedy[k];
    const hi = Math.min(a, k + 1 < extents.length ? greedy[k + 1] - S : Infinity);
    const center = Math.round((a + b) / 2 - S / 2);
    return Math.min(Math.max(center, lo), Math.max(lo, hi));
  });
}

/**
 * 列数判定：汇集全部帧、全部行的「内容间隙中点」拟合统一格子取周期。
 * - 间隙必须逐帧采集：动画里贴纸的接触时断时连，联合 alpha 上整行粘连
 *   的图往往能在分裂帧里恢复出全部格线（魔女审判型）；
 * - 中点不足（全程全粘连）时退回 1 列，由 1:1 槽位输出整块。
 */
function detectColCount(
  primary: Uint8ClampedArray,
  alphas: Uint8ClampedArray[],
  W: number,
  rowBands: Band[],
  spanX: number,
): number {
  const midpoints: number[] = [];
  for (const m of alphas) {
    for (const [y0, y1] of rowBands) {
      const bands = mergePhantoms(contentBands(projectAlpha(m, W, 0, y0, W - 1, y1, 'col')));
      for (let i = 0; i + 1 < bands.length; i++) {
        const gap = bands[i + 1][0] - bands[i][1] - 1;
        if (gap >= 1) midpoints.push(bands[i][1] + 1 + Math.floor(gap / 2));
      }
    }
  }
  if (midpoints.length < 2) return 1;
  const lo = Math.round((W - spanX) / 2);
  const lattice = estimateLattice(midpoints, lo, lo + spanX - 1);
  if (!lattice) return 1;
  return Math.min(12, Math.max(1, Math.round(spanX / lattice.pitch)));
}

/**
 * 列轴每槽的内容范围：以暂定格距（跨度/列数）把内容带归槽。
 * 带集合要逐帧采集：动画里贴纸的接触时断时连，联合 alpha 上整行粘连的
 * 图必须靠分裂帧恢复各槽的真实内容范围；粘连多格的合并带只贡献首槽
 * 左缘与末槽右缘，中段留给完整的分裂带佐证，避免虚增中间槽的内容范围。
 */
function columnExtents(
  alphas: Uint8ClampedArray[],
  W: number,
  rowBands: Band[],
  colN: number,
  xLo: number,
  spanX: number,
): Extent[] {
  const pitch = spanX / colN;
  const ext: Array<Extent | null> = new Array(colN).fill(null);
  const add = (k: number, a: number, b: number) => {
    const e = ext[k];
    ext[k] = e ? [Math.min(e[0], a), Math.max(e[1], b)] : [a, b];
  };
  const slotOf = (x: number) => Math.min(colN - 1, Math.max(0, Math.floor((x - xLo) / pitch)));
  for (const m of alphas) {
    for (const [y0, y1] of rowBands) {
      const bands = mergePhantoms(contentBands(projectAlpha(m, W, 0, y0, W - 1, y1, 'col')));
      for (const [a, b] of bands) {
        const k0 = slotOf(a);
        const k1 = slotOf(b);
        if (k0 === k1) {
          add(k0, a, b);
        } else {
          add(k0, a, a);
          add(k1, b, b);
        }
      }
    }
  }
  return ext.map((e, k) => {
    if (e) return e;
    const c = Math.round(xLo + (k + 0.5) * pitch);
    return [c, c];
  });
}

/* ---------------- 主入口 ---------------- */

/**
 * 表情包网格分析（不假设任何固定行列数）。
 * 大图必然是一个均匀网格，网格裁切不允许窗口相交，因此输出满足：
 * 全部切片同尺寸 1:1、各自容纳本格内容、相邻窗口零交集（如格距不够
 * 大于内容时窗口会适度小于格距、滑入邻格空白区）。
 * - 每槽内容范围：行轴取内容带；列轴逐帧统计间隙中点定列数后归槽
 *   （接触时断时连的动画在分裂帧里恢复格线；粘连合并带只贡献两缘）；
 * - 格尺寸 S 由「区间链」定出：S ≥ 各槽内容尺寸，且逐槽贪心排布
 *   w_k = max(b_k − S + 1, w_{k−1} + S) 不得越过下一槽内容起始；
 *   取最大可行 S，再在链内余量中让内容居中；
 * - 紧贴型满幅网格没有内容边界，用接缝颜色剖面数行列后同样成链；
 * - 窗口内全无内容（占位槽）不产出；内容原位置保留，不缩放。
 */
export function analyzeGrid({ rgba, alphas, W, H }: GridInput): CellBox[] {
  const primary = alphas[0];

  const rowProj = projectAlpha(primary, W, 0, 0, W - 1, H - 1, 'row');
  const rowBands = mergePhantoms(contentBands(rowProj));
  if (rowBands.length === 0) return [];

  const globalColBands = contentBands(projectAlpha(primary, W, 0, 0, W - 1, H - 1, 'col'));
  const spanX = globalColBands.length
    ? globalColBands[globalColBands.length - 1][1] - globalColBands[0][0] + 1
    : W;
  const spanY = rowBands[rowBands.length - 1][1] - rowBands[0][0] + 1;

  // 行列数判定与「每槽内容范围」
  let xExt: Extent[];
  let yExt: Extent[];
  if (rowBands.length === 1 && globalColBands.length <= 1 && spanX / W >= 0.6 && spanY / H >= 0.6) {
    // 紧贴型满幅网格：无内容边界可依，接缝颜色剖面数出行列数，
    // 切口之间即各槽内容范围
    const rowCuts = seamCuts(rgba, primary, W, H, 'row');
    const colCuts = seamCuts(rgba, primary, W, H, 'col');
    if (rowCuts.length < 3 || colCuts.length < 3) return [];
    xExt = colCuts.slice(0, -1).map((c, i) => [c, colCuts[i + 1] - 1]);
    yExt = rowCuts.slice(0, -1).map((c, i) => [c, rowCuts[i + 1] - 1]);
  } else {
    const colN = detectColCount(primary, alphas, W, rowBands, spanX);
    if (colN < 1) return [];
    yExt = rowBands.map(([a, b]) => [a, b]);
    xExt = columnExtents(alphas, W, rowBands, colN, globalColBands[0][0], spanX);
  }

  // 格尺寸 S：全部窗口同宽。区间链给出「零交集」的可行区间——
  // 下界为各槽内容尺寸（窗口必须容纳内容），上界受隔槽边界约束。
  // 取最小可行值：切片紧贴本格内容，不留多余透明边。
  const minS = Math.max(
    xExt.reduce((m, [a, b]) => Math.max(m, b - a + 1), 0),
    yExt.reduce((m, [a, b]) => Math.max(m, b - a + 1), 0),
  );
  let S = minS;
  for (let s = minS; s <= Math.max(W, H, minS); s++) {
    if (chainFeasible(xExt, s) && chainFeasible(yExt, s)) {
      S = s;
      break;
    }
  }

  const xStarts = chainStarts(xExt, S);
  const yStarts = chainStarts(yExt, S);

  const cells: CellBox[] = [];
  for (let ri = 0; ri < yExt.length; ri++) {
    const minY = yStarts[ri];
    const sy0 = Math.max(0, minY);
    const sy1 = Math.min(H - 1, minY + S - 1);
    if (sy0 > sy1) continue;
    for (let ci = 0; ci < xExt.length; ci++) {
      const minX = xStarts[ci];
      const sx0 = Math.max(0, minX);
      const sx1 = Math.min(W - 1, minX + S - 1);
      if (sx0 > sx1) continue;
      // 空槽（占位槽）跳过：窗口内全帧无内容则不产出
      if (!alphaBox(primary, W, sx0, sy0, sx1, sy1)) continue;
      cells.push({ minX, minY, maxX: minX + S - 1, maxY: minY + S - 1 });
    }
  }
  return cells;
}
