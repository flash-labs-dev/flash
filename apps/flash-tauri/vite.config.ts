// Builds the unchanged apps/desktop renderer for Tauri's webview. The desktop
// preload is bundled in front of it with `electron` aliased to a shim, so the
// UI keeps calling window.flash exactly as it does under Electron.
import { defineConfig } from 'vite'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const desktop = resolve(__dirname, '../desktop')
// One copy of the UI toolchain: borrow the desktop app's React and Tailwind plugins.
const fromDesktop = createRequire(resolve(desktop, 'package.json'))
const react = fromDesktop('@vitejs/plugin-react').default
const tailwind = fromDesktop('@tailwindcss/postcss')

export default defineConfig({
  root: __dirname,
  clearScreen: false,
  plugins: [react()],
  // The preload reads process.platform; Tauri builds per platform, so bake it in.
  define: { 'process.platform': JSON.stringify(process.platform) },
  resolve: {
    alias: {
      electron: resolve(__dirname, 'src/electron-shim.ts'),
      '@': resolve(desktop, 'src/renderer'),
      // The renderer lives outside this root; resolve React from the desktop app.
      react: dirname(fromDesktop.resolve('react/package.json')),
      'react-dom': dirname(fromDesktop.resolve('react-dom/package.json')),
    },
  },
  // Tailwind finds classes from its base directory, which must be the desktop sources.
  css: { postcss: { plugins: [tailwind({ base: resolve(desktop, 'src') })] } },
  server: { port: 5174, strictPort: true, fs: { allow: [resolve(__dirname, '../..')] } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
})
