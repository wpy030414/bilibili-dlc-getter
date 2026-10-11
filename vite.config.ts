import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages 项目站点，base 需设为仓库名
  base: '/bilibili-dlc-getter/',
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
  },
});