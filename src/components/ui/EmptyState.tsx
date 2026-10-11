import { M3eIcon } from '@m3e/react/icon';

export function EmptyState() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '80px 24px',
        textAlign: 'center',
        gap: 12,
      }}
    >
      <M3eIcon
        name="image_search"
        opticalSize={48}
        style={{ fontSize: 64, color: 'var(--m3e-outline)' } as React.CSSProperties}
      />
      <h2 style={{ fontSize: 22, fontWeight: 400, lineHeight: 1.3 }}>
        还没有图片
      </h2>
      <p style={{
        fontSize: 14,
        color: 'var(--m3e-on-surface-variant)',
        maxWidth: 400,
        lineHeight: 1.6,
      }}>
        在上方粘贴 Bilibili 数字周边活动链接，咱来帮你抓取卡片 &amp; 收集品图片喵～♪
      </p>
    </div>
  );
}