import { useState } from 'react';
import type { GalleryImage } from '../../types';
import { downloadZip } from '../../lib/downloadUtils';
import { M3eButton } from '@m3e/react/button';
import { M3eIcon } from '@m3e/react/icon';
import { M3eCircularProgressIndicator } from '@m3e/react/progress-indicator';
import { M3eSnackbar } from '../../lib/m3eSnackbar';

interface Props {
  images: GalleryImage[];
}

/** 卡片列表的批量打包下载按钮（行内，位于列表标题右侧） */
export function BatchDownloadButton({ images }: Props) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [snackMsg, setSnackMsg] = useState('');

  const spinnerStyle = {
    '--m3e-circular-flat-progress-indicator-diameter': '18px',
  } as React.CSSProperties;

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    setProgress(0);
    try {
      await downloadZip(images, setProgress);
      setSnackMsg(`成功下载 ${images.length} 张卡片喵～`);
    } catch {
      setSnackMsg('打包失败，请重试喵……');
    } finally {
      setDownloading(false);
      setProgress(0);
    }
  };

  return (
    <>
      <M3eButton variant="tonal" onClick={handleDownload} disabled={downloading}>
        {downloading ? (
          <>
            <M3eCircularProgressIndicator
              indeterminate
              variant="flat"
              style={spinnerStyle}
            />
            {progress}%
          </>
        ) : (
          <>
            <M3eIcon slot="icon" name="download" />
            打包下载
          </>
        )}
      </M3eButton>

      {downloading && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            background: 'var(--m3e-surface-container)',
            borderRadius: 12,
            padding: '12px 16px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            zIndex: 50,
            fontSize: 13,
            color: 'var(--m3e-on-surface-variant)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            minWidth: 200,
          }}
        >
          <M3eCircularProgressIndicator indeterminate variant="flat" style={spinnerStyle} />
          <span>打包中… {images.length} 张卡片</span>
        </div>
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
    </>
  );
}
