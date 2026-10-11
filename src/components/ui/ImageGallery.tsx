import type { GalleryImage } from '../../types';
import { ImageCard } from './ImageCard';
import { BatchDownloadButton } from './BatchDownloadButton';
import { M3eHeading } from '@m3e/react/heading';

interface Props {
  images: GalleryImage[];
}

export function ImageGallery({ images }: Props) {
  if (images.length === 0) return null;

  const cards = images.filter((i) => i.source === 'card');
  const collects = images.filter((i) => i.source === 'collect');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {cards.length > 0 && (
        <section>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <M3eHeading variant="headline" size="small">
              卡片列表（{cards.length}）
            </M3eHeading>
            <BatchDownloadButton images={cards} />
          </div>
          <div className="gallery-grid">
            {cards.map((item, i) => (
              <ImageCard key={`card-${i}`} item={item} index={i} />
            ))}
          </div>
        </section>
      )}

      {collects.length > 0 && (
        <section>
          <M3eHeading variant="headline" size="small" style={{ marginBottom: 16 }}>
            收集品列表（{collects.length}）
          </M3eHeading>
          <div className="gallery-grid">
            {collects.map((item, i) => (
              <ImageCard key={`collect-${i}`} item={item} index={i} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}