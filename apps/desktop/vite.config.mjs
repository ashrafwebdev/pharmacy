import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the built UI loads correctly from inside the packaged app (file://).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
