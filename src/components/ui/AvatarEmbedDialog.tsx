import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { M3eDialog } from '@m3e/react/dialog';
import { M3eButton } from '@m3e/react/button';
import { M3eIcon } from '@m3e/react/icon';
import { M3eCircularProgressIndicator } from '@m3e/react/progress-indicator';
import {
  loadPendantTemplate,
  loadUserImage,
  composeEmbeddedAvatar,
  downloadEmbeddedAvatar,
  clampAvatarRadius,
} from '../../lib/imageProcessing';
import type { PendantTemplate } from '../../lib/imageProcessing';
import { resolveCssToken, drawCheckerboard } from '../../lib/canvasUtils';
import { ParamStepper } from './ParamStepper';

interface Props {
  open: boolean;
  /** 头像挂件模板源链 */
  url: string;
  /** 用户选择的本地头像文件 */
  file: File;
  /** 用于 dialog 标题与输出文件名 */
  name: string;
  onClose: () => void;
  /** 合成结果反馈（成功 / 失败文案，由宿主卡片弹 snackbar） */
  onResult: (msg: string) => void;
}

const DIALOG_STYLE = {
  '--m3e-dialog-min-width': 'min(720px, 94vw)',
  '--m3e-dialog-max-width': 'min(980px, 96vw)',
  '--m3e-dialog-max-height': '90vh',
} as CSSProperties;

const SPINNER_STYLE = {
  '--m3e-circular-flat-progress-indicator-diameter': '20px',
} as CSSProperties;

/**
 * 绘制合成预览：透明底棋盘格 + 已合成头像（用户图圆形裁剪 + 模板叠加）。
 * 严格所见即所得——预览像素即最终产物（棋盘格只是透明区的可视化底衬）。
 */
function drawPreview(
  canvas: HTMLCanvasElement,
  template: PendantTemplate,
  userImg: HTMLImageElement,
  radius: number,
) {
  const { W, H } = template;
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
  ctx.drawImage(composeEmbeddedAvatar(template, userImg, radius), 0, 0);
}

export function AvatarEmbedDialog({ open, url, file, name, onClose, onResult }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [template, setTemplate] = useState<PendantTemplate | null>(null);
  const [userImg, setUserImg] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [radius, setRadius] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // 加载模板（每个 url 只做一次；dialog 首开后保持挂载以保留用户微调）
  useEffect(() => {
    let alive = true;
    setTemplate(null);
    setRadius(null);
    setLoadError(null);
    loadPendantTemplate(url)
      .then((t) => {
        if (alive) setTemplate(t);
      })
      .catch((err) => {
        if (alive) setLoadError(err instanceof Error ? err.message : '模板加载失败喵……');
      });
    return () => {
      alive = false;
    };
  }, [url]);

  // 加载用户头像（每次选新文件都重载，并重置半径为待初始化）
  useEffect(() => {
    let alive = true;
    setUserImg(null);
    setRadius(null);
    loadUserImage(file)
      .then((img) => {
        if (alive) setUserImg(img);
      })
      .catch((err) => {
        if (alive) setLoadError(err instanceof Error ? err.message : '头像读取失败喵……');
      });
    return () => {
      alive = false;
    };
  }, [file]);

  // 半径初始值：模板推断值（两图就绪后填入，此后完全由用户接管）
  useEffect(() => {
    if (template && userImg && radius === null) setRadius(template.radius);
  }, [template, userImg, radius]);

  // 半径变化即重绘预览
  useEffect(() => {
    if (!template || !userImg || radius === null || !canvasRef.current) return;
    drawPreview(canvasRef.current, template, userImg, radius);
  }, [template, userImg, radius]);

  const ready = !!(template && userImg && radius !== null);

  const updateRadius = (raw: number) => {
    if (!template) return;
    setRadius(clampAvatarRadius(raw, template.W, template.H));
  };

  const handleConfirm = async () => {
    if (!template || !userImg || radius === null || busy) return;
    setBusy(true);
    try {
      await downloadEmbeddedAvatar(template, userImg, radius, name);
      onResult('头像已合成下载喵～');
      onClose();
    } catch (err) {
      onResult(err instanceof Error ? err.message : '头像合成失败喵……');
    } finally {
      setBusy(false);
    }
  };

  return (
    // disableClose：背景 / 右上角叉 / ESC 均不可关闭，只能走「取消」或确认完成
    <M3eDialog open={open} disableClose style={DIALOG_STYLE} onClosed={onClose}>
      <span slot="header">合成「{name}」</span>

      {!ready && !loadError && (
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
            正在读取头像与模板喵…
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

      {ready && template && radius !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* 宽屏：预览与参数左右分栏；窄屏堆叠 */}
          <div className="crop-body">
            <div className="crop-body-left">
              <canvas ref={canvasRef} className="crop-preview" aria-label="头像合成预览" />
              <div className="crop-info">
                头像半径 {radius} px · 直径 {radius * 2} px · 模板 {template.W}×{template.H} px
              </div>
            </div>
            <div className="crop-params">
              <section className="crop-param-group is-wide">
                <h4>头像（px）</h4>
                <ParamStepper
                  label="头像半径"
                  value={radius}
                  min={1}
                  onChange={updateRadius}
                />
              </section>
            </div>
          </div>
        </div>
      )}

      <div slot="actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <M3eButton variant="text" onClick={onClose} disabled={busy}>
          取消
        </M3eButton>
        <M3eButton variant="filled" onClick={handleConfirm} disabled={!ready || busy}>
          {busy ? (
            <M3eCircularProgressIndicator indeterminate variant="flat" style={SPINNER_STYLE} />
          ) : (
            <M3eIcon slot="icon" name="download" />
          )}
          确认合成
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
