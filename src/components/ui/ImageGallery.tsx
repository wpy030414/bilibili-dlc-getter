import type { GallerySection } from '../../types';
import { ImageCard } from './ImageCard';
import { BatchDownloadButton } from './BatchDownloadButton';
import { M3eHeading } from '@m3e/react/heading';

interface Props {
  sections: GallerySection[];
}

export function ImageGallery({ sections }: Props) {
  if (sections.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {sections.map((section) => (
        <section key={section.key}>
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
              {section.label}（{section.images.length}）
            </M3eHeading>
            {section.downloadable && <BatchDownloadButton images={section.images} />}
          </div>
          <div className="gallery-grid">
            {section.images.map((item, i) => (
              <ImageCard key={`${section.key}-${i}`} item={item} index={i} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
