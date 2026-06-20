import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    globals: true,
    environment: 'node',
    exclude: ['tests/**', 'node_modules/**', 'out/**', 'release/**'],
    coverage: {
      reporter: ['text', 'html']
    }
  }
})
