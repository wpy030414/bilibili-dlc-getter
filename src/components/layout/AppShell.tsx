import { M3eTheme } from '@m3e/react/theme';
import { M3eAppBar } from '@m3e/react/app-bar';
import { M3eIconButton } from '@m3e/react/icon-button';
import { M3eIcon } from '@m3e/react/icon';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

export function AppShell({ children }: Props) {
  return (
    <M3eTheme color="#9c4146" scheme="auto">
      <M3eAppBar
        size="small"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          '--m3e-app-bar-container-color': 'var(--m3e-surface-container)',
        } as React.CSSProperties}
      >
        <M3eIconButton slot="leading" aria-label="Logo">
          <M3eIcon name="photo_library" />
        </M3eIconButton>
        <span slot="title">Bilibili DLC Getter</span>
        <M3eIconButton
          slot="trailing"
          aria-label="GitHub 仓库"
          href="https://github.com/wpy030414/bilibili-dlc-getter"
          target="_blank"
          rel="noreferrer"
        >
          {/* GitHub 品牌图标不在 Material Symbols 中，使用官方 mark */}
          <svg
            viewBox="0 0 16 16"
            width="20"
            height="20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </M3eIconButton>
      </M3eAppBar>
      <main
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: 'clamp(16px, 3vw, 24px)',
        }}
      >
        {children}
      </main>
    </M3eTheme>
  );
}