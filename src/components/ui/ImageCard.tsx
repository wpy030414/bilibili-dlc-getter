import { useRef, useState, useCallback } from 'react';
import type { GalleryImage } from '../../types';
import { EmojiCropDialog } from './EmojiCropDialog';
import { AvatarEmbedDialog } from './AvatarEmbedDialog';
import { M3eCard } from '@m3e/react/card';
import { M3eIcon } from '@m3e/react/icon';
import { M3eIconButton } from '@m3e/react/icon-button';
import { M3eSnackbar } from '../../lib/m3eSnackbar';

interface Props {
  item: GalleryImage;
  index: number;
}

export function ImageCard({ item, index }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [snackMsg, setSnackMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 切割 dialog：open 控制显隐；openedOnce 让 dialog 首开后保持挂载，
  // 重开时保留用户的参数微调（迭代式调整的工作流）
  const [cropOpen, setCropOpen] = useState(false);
  const [cropOpenedOnce, setCropOpenedOnce] = useState(false);
  // 头像合成 dialog：选文件后才打开；同样保持挂载以保留半径微调
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [avatarOpenedOnce, setAvatarOpenedOnce] = useState(false);

  /** 图片若在挂载前已完成（缓存命中），onLoad 不会再触发，需补一次检查 */
  const setImgRef = useCallback((el: HTMLImageElement | null) => {
    if (el?.complete) setLoaded(true);
  }, []);

  // 特殊服务由数据源显式标记：表情（网格拼图切割）、头像挂件（模板嵌入）
  const isEmojiPack = item.service === 'emoji';
  const isPendant = item.service === 'pendant';

  const showSnack = (msg: string) => setSnackMsg(msg);

  const openCropDialog = () => {
    setCropOpenedOnce(true);
    setCropOpen(true);
  };

  // 选好本地头像后进入合成 dialog：预览效果 + 确定半径（px），确认才下载
  const handleFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAvatarFile(file);
    setAvatarOpenedOnce(true);
    setAvatarOpen(true);
  };

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
        {/* 卡片美术图满幅 cover；产品图 contain 完整展示不裁切 */}
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
            objectFit: item.fit,
            padding: item.fit === 'cover' ? 0 : 12,
            display: 'block',
            background: 'var(--md-sys-color-surface-container-highest, #e0e0e0)',
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
                aria-label="切割表情包"
                onClick={openCropDialog}
              >
                <M3eIcon name="content_cut" />
              </M3eIconButton>
            )}
            {isPendant && (
              <M3eIconButton
                size="extra-small"
                aria-label="嵌入头像"
                onClick={() => fileInputRef.current?.click()}
              >
                <M3eIcon name="join_inner" />
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

      {isEmojiPack && cropOpenedOnce && (
        <EmojiCropDialog
          open={cropOpen}
          url={item.img}
          name={item.name}
          onClose={() => setCropOpen(false)}
          onResult={showSnack}
        />
      )}

      {isPendant && avatarOpenedOnce && avatarFile && (
        <AvatarEmbedDialog
          open={avatarOpen}
          url={item.img}
          file={avatarFile}
          name={item.name}
          onClose={() => setAvatarOpen(false)}
          onResult={showSnack}
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
