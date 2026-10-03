import type { PrintOptions } from '../kernel/types'

const key = 'okc.print-settings.v1'
export const defaultPrintSettings: PrintOptions = { nozzle: 0.4, bed: [220, 220, 250] }

export function validPrintSettings(value: unknown): value is PrintOptions {
  if (!value || typeof value !== 'object') return false
  const candidate = value as PrintOptions
  return (
    Number.isFinite(candidate.nozzle) &&
    candidate.nozzle >= 0.05 &&
    candidate.nozzle <= 5 &&
    Array.isArray(candidate.bed) &&
    candidate.bed.length === 3 &&
    candidate.bed.every((size) => Number.isFinite(size) && size >= 1 && size <= 10000)
  )
}

export function loadPrintSettings(): PrintOptions {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (validPrintSettings(value)) return value
  } catch {}
  return structuredClone(defaultPrintSettings)
}

export function savePrintSettings(value: PrintOptions): void {
  if (!validPrintSettings(value)) return
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}
