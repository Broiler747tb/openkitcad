import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const output = resolve(process.env.SHOWCASE_OUTPUT || resolve(root, 'release/showcase'))
export const browserOptions = process.env.CHROMIUM_EXECUTABLE_PATH
  ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
  : {}
export function renderResolve() {
  const require = createRequire(import.meta.url)
  const entry = require.resolve('three-gpu-pathtracer', {
    paths: [process.env.SHOWCASE_DEPENDENCIES || root],
  })
  return {
    dedupe: ['three'],
    alias: { 'three-gpu-pathtracer': resolve(dirname(entry), '../src/index.js') },
  }
}
