import { M3eIcon } from '@m3e/react/icon';
import { M3eButton } from '@m3e/react/button';

interface Props {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: Props) {
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
        name="error_outline"
        opticalSize={48}
        style={{ fontSize: 64, color: 'var(--m3e-error)' } as React.CSSProperties}
      />
      <h2 style={{ fontSize: 20, fontWeight: 500 }}>出错了喵……</h2>
      <p style={{
        fontSize: 14,
        color: 'var(--m3e-on-surface-variant)',
        maxWidth: 480,
        lineHeight: 1.6,
        wordBreak: 'break-word',
      }}>
        {message}
      </p>
      {onRetry && (
        <M3eButton
          variant="outlined"
          onClick={onRetry}
          style={{ marginTop: 4 }}
        >
          <M3eIcon slot="icon" name="refresh" />
          重试
        </M3eButton>
      )}
    </div>
  );
}