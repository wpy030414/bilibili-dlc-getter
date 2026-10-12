/**
 * 表情包网格分析：从像素推断「均匀网格参数」（行/列数、四边外边距、行/列间距），
 * 作为切割 dialog 的初始值，由用户在预览中微调后执行参数化裁切。
 * 纯计算模块（无 DOM 依赖），供 imageProcessing 调用，也可在 Node 中直接测试。
 *
 * 推断分层：
 * - 常规层：行轴按（联合）alpha 内容带分段（幻影带并回邻居）；列数由全部帧、
 *   全部行的「内容间隙中点」拟合周期判定——动画里贴纸接触时断时连，
 *   联合 alpha 上整行粘连的图能在分裂帧里恢复格线。
 * - 兜底层：内容满幅且完全无间隙（紧贴型网格）时没有内容边界可依，
 *   用接缝颜色剖面数出行列数。
 * - 对齐策略：格线吸附内容带中心 lattice / 间隙中点 lattice（首格起算，
 *   无累积漂移）；间距自最小内容间隙起、以内容覆盖修正收尾——
 *   窗口宁可多带空白，也不切进贴纸。
 * - 几何：裁切窗按各轴自然格（同轴统一整数、无逐格抖动、不强制补方）；
 *   两轴恰相等时即严格 1:1——是否 1:1 由 dialog 据 gridCellRects 的 w、h
 *   实时判定后，才决定是否标注「（1:1）」。
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

/* ---------------- 通用小工具 ---------------- */

function lowerMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1];
}

/**
 * 格间距去噪：1px 视为像素噪声、归 0。相邻贴纸各自的抗锯齿边缘相接时，
 * 逐像素投影上会偶现 1px 透明缝（贴纸实际紧贴、格间距为 0）；这些排版里
 * 真实格间距要么 0、要么 ≥3px，不存在真正的 1px 缝隙。若把噪声当格间距，
 * 列格会被压小 1px（与行格不等），窗口随之变非方。
 */
function snapGap(gap: number): number {
  return gap <= 1 ? 0 : gap;
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

/* ---------------- 参数化网格：推断与几何 ---------------- */

/** 用户可微调的均匀网格参数（长度全部为 px） */
export interface GridParams {
  /** 行数 / 列数 */
  rows: number;
  cols: number;
  /** 上下左右外边距 */
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  /** 行间距 / 列间距 */
  rowGap: number;
  colGap: number;
}

/** 单轴均匀网格拟合：自 lead 起排 count 格、格间距 gap、尾侧余量 trail */
interface AxisFit {
  count: number;
  lead: number;
  trail: number;
  gap: number;
}

/**
 * 由内容带拟合单轴（格线吸附带中心 lattice），间距与起点由 finishAxis 落定。
 */
function fitBands(bands: Band[], extent: number): AxisFit {
  const n = bands.length;
  if (n === 0) return { count: 1, lead: 0, trail: 0, gap: 0 };
  const contentStart = bands[0][0];
  const contentEnd = bands[n - 1][1];
  if (n === 1) return { count: 1, lead: contentStart, trail: extent - 1 - contentEnd, gap: 0 };

  let minGap = Infinity;
  for (let i = 0; i + 1 < n; i++) {
    minGap = Math.min(minGap, bands[i + 1][0] - bands[i][1] - 1);
  }
  const gap = snapGap(Math.round(minGap));
  const centers = bands.map(([a, b]) => (a + b) / 2);
  const pitchInt = Math.max(1, Math.round((centers[n - 1] - centers[0]) / (n - 1)));
  return finishAxis(n, pitchInt, gap, contentStart, contentEnd, extent, centers[0]);
}

/**
 * 列轴拟合：多行图的整幅列投影常粘连，列数与格线由「内容间隙中点」
 * 拟合的周期 lattice 判定（接触时断时连的动画靠分裂帧恢复格线），
 * 首格中心吸附到内容左侧最近一条格线 + 半格距。无格线佐证时退回整幅列带直接拟合。
 */
function fitColumns(
  alphas: Uint8ClampedArray[],
  W: number,
  rowBands: Band[],
  colBands: Band[],
): AxisFit {
  const contentStart = colBands[0][0];
  const contentEnd = colBands[colBands.length - 1][1];
  const spanX = contentEnd - contentStart + 1;

  // 逐帧逐行采集「内容间隙中点与间隙宽」
  const midpoints: number[] = [];
  const gaps: number[] = [];
  for (const m of alphas) {
    for (const [y0, y1] of rowBands) {
      const bands = mergePhantoms(contentBands(projectAlpha(m, W, 0, y0, W - 1, y1, 'col')));
      for (let i = 0; i + 1 < bands.length; i++) {
        const gap = bands[i + 1][0] - bands[i][1] - 1;
        midpoints.push(bands[i][1] + 1 + Math.floor(gap / 2));
        gaps.push(gap);
      }
    }
  }

  const lo = Math.round((W - spanX) / 2);
  const lattice = midpoints.length >= 2 ? estimateLattice(midpoints, lo, lo + spanX - 1) : null;
  if (!lattice) return fitBands(colBands, W);

  const count = Math.min(12, Math.max(1, Math.round(spanX / lattice.pitch)));
  if (count <= 1) return { count: 1, lead: contentStart, trail: W - 1 - contentEnd, gap: 0 };

  const minGap = gaps.length ? Math.max(0, Math.min(...gaps)) : 0;
  const pitchInt = Math.max(1, Math.round(lattice.pitch));
  // 格线相位（绝对坐标）：midpoints 对周期取模的相位即格线位置，再偏移半格距
  // 得到「首格中心」相位——注意不能用画布居中假设的 lo 作相位基准，
  // 否则格线整体平移、首窗被钳到 0、余量全堆到右侧
  const slotPhase = lattice.offset + pitchInt / 2;
  const k = Math.round((contentStart - slotPhase) / pitchInt);
  return finishAxis(count, pitchInt, snapGap(Math.round(minGap)), contentStart, contentEnd, W, slotPhase + k * pitchInt);
}

/** 满幅紧贴网格：接缝切割位置 → 均匀参数（无间隙） */
function fitFromCuts(cuts: number[], extent: number): AxisFit {
  if (cuts.length < 3) return { count: 1, lead: 0, trail: 0, gap: 0 };
  return {
    count: cuts.length - 1,
    lead: Math.max(0, cuts[0]),
    trail: Math.max(0, extent - cuts[cuts.length - 1]),
    gap: 0,
  };
}

/**
 * 轴拟合收尾：由格距 pitch、期望间距、内容范围与首格中心落定均匀参数。
 * - 间距下限：n × pitch − gap ≤ extent（尾边距不透支）；
 * - 间距上限：最小内容间隙（窗口宁可多带空白，也不切进贴纸）；
 * - 覆盖修正：末窗右缘够不到内容末端时，逐 px 把间距让给格子（每让 1px
 *   末缘推进 n px）——最小间隙估值偏大时不至于切掉末列内容；
 * - 首格起点：以首格中心对齐（无累积漂移），且不超过内容起点。
 */
function finishAxis(
  n: number,
  pitchInt: number,
  gapPreferred: number,
  contentStart: number,
  contentEnd: number,
  extent: number,
  anchorCenter: number,
): AxisFit {
  const gapFloor = Math.max(0, n * pitchInt - extent);
  const gapCeil = Math.min(Math.max(0, gapPreferred), pitchInt - 1);
  let gap = Math.max(gapFloor, gapCeil);
  let cell = pitchInt - gap;
  // 先钳到 [0, contentStart]：锚点在内容左侧远处时 lead 可能为负，
  // 不钳位会让覆盖修正把间距整段磨光
  let lead = Math.max(0, Math.min(Math.round(anchorCenter - cell / 2), contentStart));

  const span = () => n * cell + (n - 1) * gap;
  while (lead + span() < contentEnd + 1 && gap > gapFloor) {
    gap--;
    cell = pitchInt - gap;
  }
  // 精确化落点：格尺寸与首格起点改由内容跨度锚定——网格恰好包住内容（外圈格
  // 外缘 = 内容外缘），且用「覆盖修正后的最终间距」而非最小内容间隙。这样格尺寸
  // 不再受各格贴纸在格内的高低偏移/漏空累积出的 ±1~3px 噪声影响（内容跨度 968、
  // 间距 56 必得 200，而非被顶成 201；边距也回到 56/40 而非 55/53、38/37）。
  const cellExact = Math.max(1, Math.round((contentEnd - contentStart + 1 - (n - 1) * gap) / n));
  let cellFit = cellExact;
  let spanExact = n * cellFit + (n - 1) * gap;
  while (spanExact > extent && cellFit > 1) {
    cellFit--;
    spanExact -= n;
  }
  const leadExact = Math.max(0, Math.min(contentStart, extent - spanExact));
  return { count: n, lead: leadExact, trail: extent - leadExact - spanExact, gap };
}

/**
 * 网格参数推断（不假设任何固定行列数），为切割 dialog 提供初始值：
 * - 行轴由（联合）alpha 行内容带拟合，列轴由间隙中点 lattice 拟合；
 * - 紧贴型满幅网格（行列均无间隙）退回接缝颜色剖面数行列；
 * - 推断只求「接近」，精确对齐交给用户在预览中微调。
 */
export function inferGridParams({ rgba, alphas, W, H }: GridInput): GridParams {
  const primary = alphas[0];
  const rowBands = mergePhantoms(contentBands(projectAlpha(primary, W, 0, 0, W - 1, H - 1, 'row')));
  const colBands = mergePhantoms(contentBands(projectAlpha(primary, W, 0, 0, W - 1, H - 1, 'col')));

  let x: AxisFit;
  let y: AxisFit;
  if (rowBands.length === 0 || colBands.length === 0) {
    x = { count: 1, lead: 0, trail: 0, gap: 0 };
    y = { count: 1, lead: 0, trail: 0, gap: 0 };
  } else {
    const spanX = colBands[colBands.length - 1][1] - colBands[0][0] + 1;
    const spanY = rowBands[rowBands.length - 1][1] - rowBands[0][0] + 1;
    if (rowBands.length === 1 && colBands.length <= 1 && spanX / W >= 0.6 && spanY / H >= 0.6) {
      y = fitFromCuts(seamCuts(rgba, primary, W, H, 'row'), H);
      x = fitFromCuts(seamCuts(rgba, primary, W, H, 'col'), W);
    } else {
      y = fitBands(rowBands, H);
      x = fitColumns(alphas, W, rowBands, colBands);
    }
  }
  return {
    rows: y.count,
    cols: x.count,
    marginTop: y.lead,
    marginBottom: y.trail,
    marginLeft: x.lead,
    marginRight: x.trail,
    rowGap: y.gap,
    colGap: x.gap,
  };
}

/** 参数有效性：全部非负整数、行列 ≥ 1、每格至少 1px */
export function gridParamsValid(p: GridParams, W: number, H: number): boolean {
  const values = [
    p.rows,
    p.cols,
    p.marginTop,
    p.marginBottom,
    p.marginLeft,
    p.marginRight,
    p.rowGap,
    p.colGap,
  ];
  if (values.some((v) => !Number.isInteger(v) || v < 0)) return false;
  if (p.rows < 1 || p.cols < 1) return false;
  const innerW = W - p.marginLeft - p.marginRight - (p.cols - 1) * p.colGap;
  const innerH = H - p.marginTop - p.marginBottom - (p.rows - 1) * p.rowGap;
  return innerW >= p.cols && innerH >= p.rows;
}

/**
 * 单轴自然格尺寸：ceil(内宽 / 格数)——宁可多吃边距空白也不切进贴纸（与
 * finishAxis 的覆盖修正同一原则，且 ceil ≥ 理想浮点值，覆盖只多不少）；
 * 再收缩到「n 格 + (n−1) 间隙」放得下 [lead, extent] 为止（满幅 trail=0 时的
 * 画布越界保护）。恒为整数 ≥ 1；整除不尽的余量留在末格右侧。
 */
function axisCellSize(
  lead: number,
  trail: number,
  gap: number,
  n: number,
  extent: number,
): number {
  const inner = extent - lead - trail - (n - 1) * gap;
  let cell = Math.max(1, Math.ceil(inner / n));
  const maxSpan = extent - lead;
  while (cell > 1 && n * cell + (n - 1) * gap > maxSpan) cell--;
  return cell;
}

/** 单轴每格起点：格距 = 自然格尺寸 + 间隙，自 lead 起（起点间距 ≠ 格宽，差一个 gap） */
function axisStarts(lead: number, gap: number, n: number, cell: number): number[] {
  const pitch = cell + gap;
  const starts: number[] = [];
  for (let k = 0; k < n; k++) starts.push(lead + k * pitch);
  return starts;
}

/** 参数化格子矩形 */
export interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 由网格参数计算全部格子矩形（预览与切割共用的唯一几何来源）。
 * 裁切窗按**各轴自然格尺寸**：宽 = 列格、高 = 行格，同轴内统一整数、无逐格
 * 抖动；两轴恰好相等时裁切窗即严格 1:1 正方形——是否 1:1 由调用方（dialog）
 * 用本函数算出的 w、h 据实判定，这里不做任何强制补方。
 */
export function gridCellRects(p: GridParams, W: number, H: number): CellRect[] {
  if (!gridParamsValid(p, W, H)) return [];
  const w = axisCellSize(p.marginLeft, p.marginRight, p.colGap, p.cols, W);
  const h = axisCellSize(p.marginTop, p.marginBottom, p.rowGap, p.rows, H);
  const xStarts = axisStarts(p.marginLeft, p.colGap, p.cols, w);
  const yStarts = axisStarts(p.marginTop, p.rowGap, p.rows, h);
  const rects: CellRect[] = [];
  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      rects.push({ x: xStarts[c], y: yStarts[r], w, h });
    }
  }
  return rects;
}

/**
 * 均匀网格的裁切窗尺寸（dialog「格」展示用）：宽 w = 列格、高 h = 行格。
 * 是否严格 1:1（w === h）由调用方据实判定后决定要不要标注——这里只如实返回
 * 算出来的 w、h，绝不替调用方硬写「1:1」。参数非法时返回 null。
 */
export function gridCellSize(
  p: GridParams,
  W: number,
  H: number,
): { w: number; h: number } | null {
  const rects = gridCellRects(p, W, H);
  if (rects.length === 0) return null;
  return { w: rects[0].w, h: rects[0].h };
}
