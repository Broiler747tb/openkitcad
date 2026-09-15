import { create } from 'zustand'
import type { SnapOptions } from '../sketch/inference'

export const DEFAULT_PREFERENCES = {
  gridVisible: true,
  axesVisible: true,
  gridStep: 5,
  gridExtent: 500,
  majorEvery: 5,
  snapGrid: true,
  snapGeometry: true,
  snapMidpoints: true,
  snapEdges: true,
  snapAlignment: true,
  snapRadius: 11,
  moveSnap: 1,
  angleSnap: 15,
  gridOpacity: 0.45,
}
export type Preferences = typeof DEFAULT_PREFERENCES
const bounds: Partial<Record<keyof Preferences, [number, number]>> = {
  gridStep: [0.01, 1000],
  gridExtent: [10, 10000],
  majorEvery: [2, 20],
  snapRadius: [2, 40],
  moveSnap: [0, 1000],
  angleSnap: [0, 180],
  gridOpacity: [0.05, 1],
}
export function normalizePreferences(input: Partial<Preferences>): Preferences {
  const out = { ...DEFAULT_PREFERENCES }
  for (const key of Object.keys(out) as (keyof Preferences)[]) {
    const v = input[key]
    if (typeof out[key] === 'boolean') {
      if (typeof v === 'boolean') (out as any)[key] = v
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      const [min, max] = bounds[key]!
      ;(out as any)[key] = Math.max(min, Math.min(max, key === 'majorEvery' ? Math.round(v) : v))
    }
  }
  return out
}
function load(): Preferences {
  try {
    return normalizePreferences(JSON.parse(localStorage.getItem('okc.preferences.v1') ?? '{}'))
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}
export const usePreferences = create<{
  values: Preferences
  set: (patch: Partial<Preferences>) => void
  reset: () => void
}>((set, get) => ({
  values: load(),
  set: (patch) => {
    const values = normalizePreferences({ ...get().values, ...patch })
    set({ values })
    try {
      localStorage.setItem('okc.preferences.v1', JSON.stringify(values))
    } catch {
      /* Storage is optional. */
    }
  },
  reset: () => get().set(DEFAULT_PREFERENCES),
}))
export function snapOptions(tolerance: number, bypass = false): SnapOptions {
  const p = usePreferences.getState().values
  return {
    tolerance,
    gridStep: bypass || !p.snapGrid ? 0 : p.gridStep,
    points: !bypass && p.snapGeometry,
    midpoints: !bypass && p.snapMidpoints,
    edges: !bypass && p.snapEdges,
    alignment: !bypass && p.snapAlignment,
  }
}
