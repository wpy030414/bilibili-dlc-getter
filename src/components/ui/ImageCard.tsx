import { useRef, useState, useCallback } from 'react';
import type { GalleryImage } from '../../types';
import { downloadEmojiPack, downloadEmbeddedAvatar } from '../../lib/imageProcessing';
import { M3eCard } from '@m3e/react/card';
import { M3eIcon } from '@m3e/react/icon';
import { M3eIconButton } from '@m3e/react/icon-button';
import { M3eCircularProgressIndicator } from '@m3e/react/progress-indicator';
import { M3eSnackbar } from '../../lib/m3eSnackbar';

interface Props {
  item: GalleryImage;
  index: number;
}

const SPINNER_STYLE = {
  '--m3e-circular-flat-progress-indicator-diameter': '20px',
} as React.CSSProperties;

export function ImageCard({ item, index }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [snackMsg, setSnackMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** 图片若在挂载前已完成（缓存命中），onLoad 不会再触发，需补一次检查 */
  const setImgRef = useCallback((el: HTMLImageElement | null) => {
    if (el?.complete) setLoaded(true);
  }, []);

  const isCard = item.source === 'card';
  // 收集品特殊服务：表情（网格拼图切割）、头像（模板嵌入）
  const isEmojiPack = !isCard && item.name.includes('表情');
  const isPendant = !isCard && (item.name.includes('头像框') || item.name.includes('头像挂件'));

  const showSnack = (msg: string) => setSnackMsg(msg);

  const handleSliceEmoji = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { total, animated } = await downloadEmojiPack(item.img, item.name);
      showSnack(
        animated > 0
          ? `已切割下载 ${total} 张表情（含 ${animated} 张动图）喵～`
          : `已切割下载 ${total} 张表情喵～`,
      );
    } catch (err) {
      showSnack(err instanceof Error ? err.message : '表情包切割失败喵……');
    } finally {
      setBusy(false);
    }
  };

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || busy) return;
    setBusy(true);
    try {
      await downloadEmbeddedAvatar(item.img, file, item.name);
      showSnack('头像已合成下载喵～');
    } catch (err) {
      showSnack(err instanceof Error ? err.message : '头像合成失败喵……');
    } finally {
      setBusy(false);
    }
  };

  const spinner = (
    <M3eCircularProgressIndicator indeterminate variant="flat" style={SPINNER_STYLE} />
  );

  return (
    <div
      className="gallery-card"
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
    >
      <M3eCard variant="filled">
        {/* 图片必须为 <img slot="header"> 直接子元素：m3e-card 的默认 slot 藏在
            <slot name="content"> 的 fallback 中，与 slot="content" 同时使用会导致
            图片内容不渲染（0×0，lazy 加载也永不触发） */}
        {/* 预览使用全尺寸源图；右键放行浏览器原生菜单（可直接另存） */}
        {/* 卡片美术图满幅 cover；收集品多为产品图，contain 完整展示不裁切 */}
        <img
          ref={setImgRef}
          slot="header"
          src={item.img}
          alt={item.name}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
          style={{
            width: '100%',
            aspectRatio: '3/4',
            objectFit: isCard ? 'cover' : 'contain',
            padding: isCard ? 0 : 12,
            display: 'block',
            background: 'var(--m3e-surface-container-highest, #e0e0e0)',
            opacity: loaded ? 1 : 0,
            transition: 'opacity 0.3s ease',
          }}
        />
        <div slot="content" style={{ paddingTop: 12 }}>
          {/* 行高锁定为文字行高，图标按钮（较小档位）不撑高卡片 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 22 }}>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 14,
                fontWeight: 500,
                lineHeight: 1.3,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {item.name}
            </div>
            {isEmojiPack && (
              <M3eIconButton
                size="extra-small"
                aria-label="切割下载表情包"
                disabled={busy}
                onClick={handleSliceEmoji}
              >
                {busy ? spinner : <M3eIcon name="content_cut" />}
              </M3eIconButton>
            )}
            {isPendant && (
              <M3eIconButton
                size="extra-small"
                aria-label="嵌入头像"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                {busy ? spinner : <M3eIcon name="join_inner" />}
              </M3eIconButton>
            )}
          </div>
        </div>
      </M3eCard>

      {isPendant && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileChosen}
        />
      )}

      {snackMsg && (
        <M3eSnackbar
          open
          duration={4000}
          action="关闭"
          onToggle={(e: Event) => {
            if ((e as ToggleEvent).newState === 'closed') setSnackMsg('');
          }}
        >
          {snackMsg}
        </M3eSnackbar>
      )}
    </div>
  );
}
