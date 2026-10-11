import { M3eSkeleton } from '@m3e/react/skeleton';

/**
 * m3e-skeleton 的宿主为 display: contents，尺寸由槽内容提供（官方为包裹式用法），
 * 因此用尺寸占位 div 放槽内，骨架自动覆盖显示
 */
function SkeletonBlock({ width, height, aspectRatio, marginBottom }: {
  width: number | string;
  height?: number;
  aspectRatio?: string;
  marginBottom?: number;
}) {
  return (
    <M3eSkeleton
      style={{
        // M3E 默认 8% 的 tint 在浅色主题下几乎不可见，略调深以明确加载反馈
        '--m3e-skeleton-tint-opacity': '0.12',
      } as React.CSSProperties}
    >
      <div style={{ width, height, aspectRatio, marginBottom }} />
    </M3eSkeleton>
  );
}

export function LoadingSkeleton() {
  return (
    <div style={{ padding: '8px 0' }}>
      <SkeletonBlock width={120} height={22} marginBottom={16} />
      <div className="gallery-grid">
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            style={{
              borderRadius: 'var(--m3e-card-shape, 12px)',
              overflow: 'hidden',
              background: 'var(--m3e-surface-container)',
            }}
          >
            <SkeletonBlock width="100%" aspectRatio="3/4" />
            <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <SkeletonBlock width="70%" height={16} />
              <SkeletonBlock width={40} height={12} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
