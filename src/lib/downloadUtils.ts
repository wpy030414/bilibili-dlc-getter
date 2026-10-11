import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import type { GalleryImage } from '../types';

/** 生成安全的文件名：去除非文件名字符 + 补序号 */
function safeFilename(index: number, name: string, ext: string): string {
  const sanitized = name.replace(/[<>:"/\\|?*]/g, '_').slice(0, 60);
  return `${String(index + 1).padStart(2, '0')}-${sanitized}.${ext}`;
}

/**
 * 批量打包下载为 ZIP：直接抓取页面现有的源图（全尺寸）
 * - B 站 CDN 返回 Access-Control-Allow-Origin: *，fetch 可直接读取
 * - 文档级 no-referrer 策略使请求不带 Referer，通过防盗链
 * 支持进度回调
 */
export async function downloadZip(
  images: GalleryImage[],
  onProgress?: (pct: number) => void,
): Promise<void> {
  const zip = new JSZip();

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    try {
      const res = await fetch(img.img);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      zip.file(safeFilename(i, img.name, ext), blob);
    } catch {
      console.warn(`Skipped image: ${img.name}`);
    }
    onProgress?.(Math.round(((i + 1) / images.length) * 100));
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  saveAs(zipBlob, 'bilibili-dlc-images.zip');
}
