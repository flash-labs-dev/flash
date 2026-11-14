import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    // electron-updater loads parts of itself at run time, so it stays a real
    // module in the package rather than being folded into the bundle.
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/main.ts'),
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/preload.ts'),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    // The design hook rewrites .impeccable/hook.cache.json on every run, and
    // the watcher was treating that as a source change and reloading the whole
    // window mid-use. It is a cache, not source.
    server: {
      watch: {
        ignored: ['**/.impeccable/**', '**/release/**', '**/out/**'],
      },
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer'),
      },
    },
  },
})
