import { AppShell } from './components/layout/AppShell';
import { UrlInput } from './components/ui/UrlInput';
import { ImageGallery } from './components/ui/ImageGallery';
import { EmptyState } from './components/ui/EmptyState';
import { ErrorState } from './components/ui/ErrorState';
import { LoadingSkeleton } from './components/ui/LoadingSkeleton';
import { useDlcData } from './hooks/useDlcData';

export default function App() {
  const { state, submit, retry } = useDlcData();

  const isLoading = state.status === 'loading';

  return (
    <AppShell>
      <UrlInput onSubmit={submit} disabled={isLoading} />

      {state.status === 'idle' && <EmptyState />}
      {state.status === 'loading' && <LoadingSkeleton />}
      {state.status === 'error' && <ErrorState message={state.message} onRetry={retry} />}
      {state.status === 'success' && (
        <>
          <div style={{
            marginBottom: 16,
            fontSize: 14,
            color: 'var(--m3e-on-surface-variant, #49454f)',
          }}>
            共找到 <strong>{state.images.length}</strong> 张图片
          </div>
          <ImageGallery images={state.images} />
        </>
      )}
    </AppShell>
  );
}