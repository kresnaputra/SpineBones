import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cloudflare({ inspectorPort: false })],
  clearScreen: false,
  server: {
    host: process.env.TAURI_DEV_HOST || '0.0.0.0',
    port: 1420,
    strictPort: true,
  },
})
