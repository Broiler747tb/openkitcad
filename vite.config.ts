import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative base so a built copy works from a file:// path or any subdirectory
  // on GitHub Pages without reconfiguration.
  base: './',
  worker: { format: 'es' },
  optimizeDeps: {
    // The OpenCascade glue is a huge emscripten bundle; prebundling it is slow
    // and breaks the `locateFile` hook used to find the .wasm.
    exclude: ['replicad-opencascadejs'],
  },
  // Bind IPv4 explicitly. Vite's default `localhost` resolves to ::1 only on
  // Windows, which some browsers refuse to connect to.
  server: { host: '127.0.0.1', port: 5273, strictPort: false },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
  },
})
