import * as React from 'react';
import { createComponent } from '@lit/react';
import { M3eSnackbarElement } from '@m3e/web/snackbar';

/**
 * @m3e/react 的 snackbar 入口仅 re-export 元素类，未提供 React 绑定，
 * 这里用 @lit/react 官方 createComponent 补齐（属性/事件映射）。
 */
export const M3eSnackbar = createComponent({
  tagName: 'm3e-snackbar',
  elementClass: M3eSnackbarElement,
  react: React,
  events: { onToggle: 'toggle' },
});
