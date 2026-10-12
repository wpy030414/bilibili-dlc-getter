import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { M3eDialog } from '@m3e/react/dialog';
import { M3eButton } from '@m3e/react/button';
import { M3eIcon } from '@m3e/react/icon';
import { M3eCircularProgressIndicator } from '@m3e/react/progress-indicator';
import { loadEmojiSheet, downloadEmojiPack } from '../../lib/imageProcessing';
import type { EmojiSheet } from '../../lib/imageProcessing';
import { inferGridParams, gridCellRects, gridCellSize, gridParamsValid } from '../../lib/gridAnalysis';
import type { GridParams } from '../../lib/gridAnalysis';
import { resolveCssToken, drawCheckerboard } from '../../lib/canvasUtils';
import { ParamStepper } from './ParamStepper';

interface Props {
  open: boolean;
  /** 表情大图源链 */
  url: string;
  /** 用于 dialog 标题与 ZIP 文件名 */
  name: string;
  onClose: () => void;
  /** 切割结果反馈（成功 / 失败文案，由宿主卡片弹 snackbar） */
  onResult: (msg: string) => void;
}

/** 大 dialog：宽幅预览 + 参数微调 */
const DIALOG_STYLE = {
  '--m3e-dialog-min-width': 'min(720px, 94vw)',
  '--m3e-dialog-max-width': 'min(980px, 96vw)',
  '--m3e-dialog-max-height': '90vh',
} as CSSProperties;

const SPINNER_STYLE = {
  '--m3e-circular-flat-progress-indicator-diameter': '20px',
} as CSSProperties;

/** 参数定义：分组渲染，input 的 DOM 顺序即此顺序 */
const PARAM_GROUPS: Array<{
  title: string;
  wide?: boolean;
  grid?: boolean;
  params: Array<{ key: keyof GridParams; label: string; min: number }>;
}> = [
  {
    title: '网格',
    params: [
      { key: 'rows', label: '行数', min: 1 },
      { key: 'cols', label: '列数', min: 1 },
    ],
  },
  {
    title: '间距（px）',
    params: [
      { key: 'rowGap', label: '行间距', min: 0 },
      { key: 'colGap', label: '列间距', min: 0 },
    ],
  },
  {
    title: '外边距（px）',
    wide: true,
    grid: true,
    params: [
      { key: 'marginTop', label: '上边距', min: 0 },
      { key: 'marginBottom', label: '下边距', min: 0 },
      { key: 'marginLeft', label: '左边距', min: 0 },
      { key: 'marginRight', label: '右边距', min: 0 },
    ],
  },
];

/**
 * 绘制裁切预览：源图（动图取首帧）+ 半透明红蒙层（被裁掉的区域）+ 保留格白描边。
 * 蒙层做法：整幅铺红后挖去保留格，保证格子边缘半像素也不被误标。
 */
function drawPreview(canvas: HTMLCanvasElement, sheet: EmojiSheet, params: GridParams) {
  const { W, H } = sheet;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  drawCheckerboard(
    ctx,
    W,
    H,
    resolveCssToken(canvas, '--md-sys-color-surface-container-high', '#ece6f0'),
    resolveCssToken(canvas, '--md-sys-color-surface-container-highest', '#e6e0e9'),
  );
  ctx.drawImage(sheet.stillCanvas ?? sheet.anim!.canvases[0], 0, 0);

  const rects = gridCellRects(params, W, H);

  const overlay = document.createElement('canvas');
  overlay.width = W;
  overlay.height = H;
  const octx = overlay.getContext('2d')!;
  octx.globalAlpha = 0.45;
  octx.fillStyle = resolveCssToken(canvas, '--md-sys-color-error', '#b3261e');
  octx.fillRect(0, 0, W, H);
  for (const r of rects) octx.clearRect(r.x, r.y, r.w, r.h);
  ctx.drawImage(overlay, 0, 0);

  // 保留格描边：线宽随图宽缩放，缩放显示后仍可见
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = Math.max(1, Math.round(Math.min(W, H) / 400));
  for (const r of rects) ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
}

export function EmojiCropDialog({ open, url, name, onClose, onResult }: Props) {
  const reactId = useId().replace(/[^a-zA-Z0-9-]/g, '');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [sheet, setSheet] = useState<EmojiSheet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [params, setParams] = useState<GridParams | null>(null);
  const [busy, setBusy] = useState(false);

  // 抓取 + 解码（每个 url 只做一次；dialog 首开后保持挂载以保留用户微调）
  useEffect(() => {
    let alive = true;
    setSheet(null);
    setLoadError(null);
    loadEmojiSheet(url)
      .then((s) => {
        if (alive) setSheet(s);
      })
      .catch((err) => {
        if (alive) setLoadError(err instanceof Error ? err.message : '图片加载失败喵……');
      });
    return () => {
      alive = false;
    };
  }, [url]);

  // 网格参数初始值：像素推断（inferGridParams），此后完全由用户接管
  useEffect(() => {
    if (!sheet) return;
    setParams((prev) =>
      prev ??
      inferGridParams({ rgba: sheet.rgba0, alphas: sheet.alphas, W: sheet.W, H: sheet.H }),
    );
  }, [sheet]);

  // 参数变化即重绘预览
  useEffect(() => {
    if (!sheet || !params || !canvasRef.current) return;
    drawPreview(canvasRef.current, sheet, params);
  }, [sheet, params]);

  const valid = !!(sheet && params && gridParamsValid(params, sheet.W, sheet.H));

  const updateParam = (key: keyof GridParams, raw: number, min: number) => {
    setParams((prev) => {
      if (!prev) return prev;
      const n = Math.floor(raw);
      return { ...prev, [key]: Number.isFinite(n) ? Math.max(min, n) : min };
    });
  };

  const handleConfirm = async () => {
    if (!sheet || !params || busy || !valid) return;
    setBusy(true);
    try {
      const { total, animated } = await downloadEmojiPack(sheet, params, name);
      onResult(
        animated > 0
          ? `已切割下载 ${total} 张表情（含 ${animated} 张动图）喵～`
          : `已切割下载 ${total} 张表情喵～`,
      );
      onClose();
    } catch (err) {
      onResult(err instanceof Error ? err.message : '表情包切割失败喵……');
    } finally {
      setBusy(false);
    }
  };

  const cellInfo = (() => {
    if (!sheet || !params) return null;
    // 裁切窗尺寸：宽 w = 列格、高 h = 行格。是否标注「（1:1）」只看 w 是否等于 h——
    // 用户改任一边距/间距致 w≠h 时，标识如实取消（不做任何强制补方）
    const dims = gridCellSize(params, sheet.W, sheet.H);
    return {
      w: dims ? String(dims.w) : '?',
      h: dims ? String(dims.h) : '?',
      square: !!dims && dims.w === dims.h,
      count: params.rows * params.cols,
      animated: !!sheet.anim,
    };
  })();

  return (
    // disableClose：背景 / 右上角叉 / ESC 均不可关闭，只能走「取消」或确认完成
    <M3eDialog open={open} disableClose style={DIALOG_STYLE} onClosed={onClose}>
      <span slot="header">切割「{name}」</span>

      {!sheet && !loadError && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
            padding: '48px 0',
            minWidth: 320,
          }}
        >
          <M3eCircularProgressIndicator indeterminate variant="flat" />
          <span style={{ color: 'var(--md-sys-color-on-surface-variant, #49454f)' }}>
            正在解析图像网格喵…
          </span>
        </div>
      )}

      {loadError && (
        <div
          style={{
            padding: '32px 0',
            minWidth: 320,
            textAlign: 'center',
            color: 'var(--md-sys-color-error, #b3261e)',
          }}
        >
          {loadError}
        </div>
      )}

      {sheet && params && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* 宽屏：预览与参数左右分栏（纵向高度一屏放下）；窄屏堆叠 */}
          <div className="crop-body">
            <div className="crop-body-left">
              <canvas
                ref={canvasRef}
                className="crop-preview"
                aria-label="裁切预览：红色半透明区域将被裁掉"
              />
              {cellInfo && (
                <div className="crop-info">
                  {params.rows} 行 × {params.cols} 列 · 格 {cellInfo.w}×{cellInfo.h} px
                  {cellInfo.square ? '（1:1）' : ''}
                  · 共 {cellInfo.count} 格{cellInfo.animated ? ' · 动图逐帧切割' : ''}
                </div>
              )}
            </div>
            <div className="crop-params" aria-describedby={`crop-invalid-${reactId}`}>
              {PARAM_GROUPS.map((g) => (
                <section
                  key={g.title}
                  className={g.wide ? 'crop-param-group is-wide' : 'crop-param-group'}
                >
                  <h4>{g.title}</h4>
                  <div className={g.grid ? 'crop-param-grid' : undefined}>
                    {g.params.map((p) => (
                      <ParamStepper
                        key={p.key}
                        label={p.label}
                        value={params[p.key]}
                        min={p.min}
                        onChange={(next) => updateParam(p.key, next, p.min)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
          {!valid && (
            <div
              id={`crop-invalid-${reactId}`}
              style={{ fontSize: 13, color: 'var(--md-sys-color-error, #b3261e)' }}
            >
              当前参数下格子不足 1px：请调小间距或外边距喵……
            </div>
          )}
        </div>
      )}

      <div slot="actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <M3eButton variant="text" onClick={onClose} disabled={busy}>
          取消
        </M3eButton>
        <M3eButton
          variant="filled"
          onClick={handleConfirm}
          disabled={!sheet || !params || !valid || busy}
        >
          {busy ? (
            <M3eCircularProgressIndicator indeterminate variant="flat" style={SPINNER_STYLE} />
          ) : (
            <M3eIcon slot="icon" name="content_cut" />
          )}
          确认切割
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
