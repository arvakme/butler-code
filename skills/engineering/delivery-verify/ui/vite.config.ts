import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One self-contained template; scripts/render.py fills the two placeholders.
export default defineConfig({
  build: { outDir: '../assets/app', emptyOutDir: true, reportCompressedSize: false },
  plugins: [react(), viteSingleFile({ removeViteModuleLoader: true })],
});
