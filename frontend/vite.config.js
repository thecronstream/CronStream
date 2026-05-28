import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Prevent Node built-ins from leaking into browser bundles
      buffer: 'buffer/',
    },
  },
  define: {
    'process.env': {},
  },
})
