import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { analyzeGrid } from './gridAnalysis';
import type { CellBox } from './gridAnalysis';

/** GIF 1-bit 透明的二值化阈值：低于该 alpha 视为全透明 */
const GIF_ALPHA_CUTOFF = 128;

/** 加载跨域图片（B 站 CDN 返回 Access-Control-Allow-Origin: *） */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`图片加载失败：${url}`));
    img.src = url;
  });
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取所选图片'));
    };
    img.src = url;
  });
}

interface CanvasData {
  canvas: HTMLCanvasElement;
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function toCanvasData(img: HTMLImageElement): CanvasData {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return { canvas, data, width: canvas.width, height: canvas.height };
}

/* ---------------- alpha 通道提取 ---------------- */

/** 从 RGBA 像素里抽出 alpha 通道 */
function alphaChannelOf(imageData: ImageData): Uint8ClampedArray {
  const { data } = imageData;
  const alpha = new Uint8ClampedArray(data.length / 4);
  for (let p = 0; p < alpha.length; p++) alpha[p] = data[p * 4 + 3];
  return alpha;
}

/* ---------------- 裁剪 / 编码基础 ---------------- */

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片编码失败'))), type, quality),
  );
}

/** 裁剪几何：内容包围盒补成 1:1 正方形（透明填充、内容居中） */
function squareGeometry(box: CellBox) {
  const w = box.maxX - box.minX + 1;
  const h = box.maxY - box.minY + 1;
  const s = Math.max(w, h);
  return { w, h, s, ox: Math.floor((s - w) / 2), oy: Math.floor((s - h) / 2) };
}

/** 裁剪「内容包围盒」并补成 1:1 正方形，输出 PNG */
async function cropSquareToBlob(source: HTMLCanvasElement, box: CellBox): Promise<Blob> {
  const { w, h, s, ox, oy } = squareGeometry(box);
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  c.getContext('2d')!.drawImage(source, box.minX, box.minY, w, h, ox, oy, w, h);
  return canvasToBlob(c, 'image/png');
}

/* ---------------- 输入加载：字节抓取 + 格式嗅探 ---------------- */

async function fetchImageBytes(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`图片下载失败：HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, mime: sniffMime(bytes) };
}

function sniffMime(b: Uint8Array): string {
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'image/webp';
  }
  return 'image/jpeg';
}

/* ---------------- 动图帧解码（WebCodecs ImageDecoder） ---------------- */

interface AnimatedFrames {
  /** 首帧 RGBA 像素，供无间隙网格的接缝颜色分析 */
  rgba0: Uint8ClampedArray;
  canvases: HTMLCanvasElement[];
  alphas: Uint8ClampedArray[];
  durationsMs: number[];
  width: number;
  height: number;
}

/**
 * 用 ImageDecoder 解出动图（GIF / 动画 WebP / APNG）的全部已合成帧。
 * 非动图、环境不支持或解码失败时返回 null，由调用方退回静态首帧路径。
 */
async function decodeAnimatedFrames(bytes: Uint8Array, mime: string): Promise<AnimatedFrames | null> {
  if (typeof ImageDecoder === 'undefined') return null;
  try {
    const decoder = new ImageDecoder({ data: bytes, type: mime });
    await decoder.tracks.ready;
    await decoder.completed;
    const track = decoder.tracks.selectedTrack;
    const count = track?.frameCount ?? 0;
    if (count <= 1) return null;

    const canvases: HTMLCanvasElement[] = [];
    const alphas: Uint8ClampedArray[] = [];
    const durationsMs: number[] = [];
    let rgba0 = new Uint8ClampedArray(0);
    let width = 0;
    let height = 0;
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      width = image.displayWidth;
      height = image.displayHeight;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0);
      const durationMs = (image.duration ?? 0) / 1000;
      image.close();
      const imageData = ctx.getImageData(0, 0, width, height);
      canvases.push(canvas);
      alphas.push(alphaChannelOf(imageData));
      durationsMs.push(durationMs);
      if (i === 0) rgba0 = imageData.data;
    }
    return { rgba0, canvases, alphas, durationsMs, width, height };
  } catch {
    return null;
  }
}

/* ---------------- 动图帧重编码：逐帧量化 → GIF 动画 ---------------- */

/**
 * 逐格 GIF 编码：每帧独立量化（255 色 + 1 个纯透明槽位），时长毫秒。
 * GIF 仅支持 1-bit 透明，先将 alpha 二值化：半透明边缘压到全透明 / 不透明两侧。
 */
function encodeCellGif(
  size: number,
  frames: Array<{ data: Uint8ClampedArray; durationMs: number }>,
): Blob {
  const gif = GIFEncoder();
  frames.forEach((frame) => {
    const rgba = new Uint8ClampedArray(frame.data); // 不改动调用方数据
    for (let p = 0; p < rgba.length; p += 4) {
      if (rgba[p + 3] < GIF_ALPHA_CUTOFF) {
        rgba[p] = 0;
        rgba[p + 1] = 0;
        rgba[p + 2] = 0;
        rgba[p + 3] = 0;
      } else {
        rgba[p + 3] = 255;
      }
    }
    // 颜色量化走 rgb565（质量最高）；调色板补齐 alpha 后走 rgba4444 映射，
    // 透明像素（0,0,0,0）与追加的纯透明槽位精确相等，保证落位到透明索引
    const palette = quantize(rgba, 255, { format: 'rgb565' });
    for (const color of palette) color[3] = 255;
    palette.push([0, 0, 0, 0]);
    const transparentIndex = palette.length - 1;
    const index = applyPalette(rgba, palette, 'rgba4444');
    gif.writeFrame(index, size, size, {
      palette,
      delay: frame.durationMs,
      transparent: true,
      transparentIndex,
    });
  });
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

/** 逐像素比较两份 ImageData 是否完全一致 */
function imageDataEqual(a: ImageData, b: ImageData): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  const ua = new Uint32Array(a.data.buffer, a.data.byteOffset, a.data.byteLength / 4);
  const ub = new Uint32Array(b.data.buffer, b.data.byteOffset, b.data.byteLength / 4);
  for (let i = 0; i < ua.length; i++) {
    if (ua[i] !== ub[i]) return false;
  }
  return true;
}

/* ---------------- 切割主流程 ---------------- */

/** 静态图切割：PNG 输出 */
async function sliceStillPack(bytes: Uint8Array, mime: string): Promise<Blob[]> {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime })).catch(() => null);
  if (!bitmap) throw new Error('图片解码失败，无法切割');
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const boxes = analyzeGrid({
    rgba: imageData.data,
    alphas: [alphaChannelOf(imageData)],
    W: canvas.width,
    H: canvas.height,
  });
  const blobs: Blob[] = [];
  for (const box of boxes) blobs.push(await cropSquareToBlob(canvas, box));
  return blobs;
}

/** 动图切割：格子逐帧重编码，动的格子输出动画 GIF，静止的格子输出 PNG */
async function sliceAnimatedPack(anim: AnimatedFrames): Promise<Blob[]> {
  const { width: W, height: H } = anim;

  // 全帧联合 alpha：动画动作可能超出单帧的静止范围，用联合范围做网格与裁剪基准
  const union = new Uint8ClampedArray(W * H);
  for (const alpha of anim.alphas) {
    for (let p = 0; p < union.length; p++) {
      if (alpha[p] > union[p]) union[p] = alpha[p];
    }
  }

  const boxes = analyzeGrid({ rgba: anim.rgba0, alphas: [union, ...anim.alphas], W, H });
  const blobs: Blob[] = [];
  for (const box of boxes) {
    const { w, h, s, ox, oy } = squareGeometry(box);

    // 每帧按同一裁剪范围画到 1:1 方画布，帧间帧内几何完全对齐
    const squares: HTMLCanvasElement[] = [];
    for (const frameCanvas of anim.canvases) {
      const c = document.createElement('canvas');
      c.width = s;
      c.height = s;
      c.getContext('2d')!.drawImage(frameCanvas, box.minX, box.minY, w, h, ox, oy, w, h);
      squares.push(c);
    }

    // 去掉与前一帧完全相同的帧（时长并入前一帧），得到该格子的有效帧序列
    const kept: Array<{ canvas: HTMLCanvasElement; data: Uint8ClampedArray; durationMs: number }> = [];
    let lastData: ImageData | null = null;
    for (let i = 0; i < squares.length; i++) {
      const imageData = squares[i].getContext('2d')!.getImageData(0, 0, s, s);
      const durationMs = Math.max(10, Math.round(anim.durationsMs[i]));
      if (lastData && imageDataEqual(imageData, lastData)) {
        kept[kept.length - 1].durationMs += durationMs;
      } else {
        kept.push({ canvas: squares[i], data: imageData.data, durationMs });
        lastData = imageData;
      }
    }

    if (kept.length <= 1) {
      // 整段无变化：按静态表情输出 PNG
      blobs.push(await canvasToBlob(kept[0].canvas, 'image/png'));
    } else {
      blobs.push(
        encodeCellGif(
          s,
          kept.map((k) => ({ data: k.data, durationMs: k.durationMs })),
        ),
      );
    }
  }
  return blobs;
}

/**
 * 表情包切割：这类图由多行多列网格拼成。
 * 行列数与行列间距全部从像素实时分析（见 analyzeGrid），不写死网格尺寸；
 * 紧贴型网格（行列均无间隙）由接缝颜色剖面还原网格。
 * 动图（GIF / 动画 WebP / APNG）逐帧切割：动的格子产出动画 GIF，静止格子产出 PNG。
 */
export async function sliceEmojiPack(url: string): Promise<Blob[]> {
  const { bytes, mime } = await fetchImageBytes(url);
  const anim = await decodeAnimatedFrames(bytes, mime);
  if (anim) return sliceAnimatedPack(anim);
  return sliceStillPack(bytes, mime);
}

/* ---------------- 头像挂件嵌入 ---------------- */

/**
 * 头像挂件嵌入：模板为「中心透明圆孔 + 环形装饰」。
 * 解析模式：从圆心向四个方向扫描首个不透明像素得到各向内圆距离，
 * 取次大值为头像半径（与主体装饰留出安全距离，允许凸出装饰自然叠压）。
 * 用户图按 cover 缩放并圆形裁剪，居中嵌入圆孔，最后叠加模板输出。
 */
export async function embedAvatarInPendant(pendantUrl: string, userFile: File): Promise<Blob> {
  const template = await loadImage(pendantUrl);
  const userImg = await loadImageFromFile(userFile);
  const src = toCanvasData(template);
  const { data, width: W, height: H } = src;
  const cx = Math.floor(W / 2);
  const cy = Math.floor(H / 2);

  const scan = (dx: number, dy: number): number => {
    let x = cx;
    let y = cy;
    let d = 0;
    while (x >= 0 && x < W && y >= 0 && y < H) {
      if (data[(y * W + x) * 4 + 3] > 20) return d;
      x += dx;
      y += dy;
      d++;
    }
    return Math.min(W, H);
  };
  const distances = [scan(-1, 0), scan(1, 0), scan(0, -1), scan(0, 1)].sort((a, b) => b - a);
  const radius = distances[1] ?? Math.min(W, H) / 4;
  const d = radius * 2;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // 圆形裁剪用户图（cover 缩放，居中）
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  const scale = Math.max(d / userImg.naturalWidth, d / userImg.naturalHeight);
  const dw = userImg.naturalWidth * scale;
  const dh = userImg.naturalHeight * scale;
  ctx.drawImage(userImg, cx - dw / 2, cy - dh / 2, dw, dh);
  ctx.restore();

  // 叠加模板（中心透明区透出头像）
  ctx.drawImage(template, 0, 0);

  return canvasToBlob(canvas, 'image/png');
}

/* ---------------- 下载入口 ---------------- */

export interface EmojiPackResult {
  total: number;
  animated: number;
}

/** 表情包切割并打包 ZIP 下载，返回小图数量与其中动图数量 */
export async function downloadEmojiPack(url: string, name: string): Promise<EmojiPackResult> {
  const blobs = await sliceEmojiPack(url);
  const zip = new JSZip();
  let animated = 0;
  blobs.forEach((blob, i) => {
    const isAnimated = blob.type === 'image/gif';
    if (isAnimated) animated++;
    zip.file(`${String(i + 1).padStart(2, '0')}.${isAnimated ? 'gif' : 'png'}`, blob);
  });
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  saveAs(zipBlob, `${name}.zip`);
  return { total: blobs.length, animated };
}

/** 合成头像并下载 */
export async function downloadEmbeddedAvatar(
  pendantUrl: string,
  userFile: File,
  name: string,
): Promise<void> {
  const blob = await embedAvatarInPendant(pendantUrl, userFile);
  saveAs(blob, `${name}-头像.png`);
}
