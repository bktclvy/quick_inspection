import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'

function resolveBackendPort(): number {
  if (process.env.VITE_API_PORT) {
    return Number(process.env.VITE_API_PORT)
  }
  const portFile = path.resolve(__dirname, '..', '.dev-port')
  try {
    const content = fs.readFileSync(portFile, 'utf-8').trim()
    const port = Number(content)
    if (port > 0) return port
  } catch { /* fallback */ }
  return 8000
}

const port = resolveBackendPort()
const API_TARGET = `http://127.0.0.1:${port}`

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': API_TARGET,
      '/stream': API_TARGET,
      '/ws': { target: `ws://127.0.0.1:${port}`, ws: true },
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
})
