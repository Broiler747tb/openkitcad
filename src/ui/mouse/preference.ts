import { create } from 'zustand'
import { DEFAULT_MOUSE_SCHEME, MOUSE_SCHEMES, type MouseSchemeId } from './schemes'

const STORAGE_KEY = 'okc.mouse.v1'

function load(): MouseSchemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored && stored in MOUSE_SCHEMES ? (stored as MouseSchemeId) : DEFAULT_MOUSE_SCHEME
  } catch {
    return DEFAULT_MOUSE_SCHEME
  }
}

export const useMouseScheme = create<{
  scheme: MouseSchemeId
  setScheme: (scheme: MouseSchemeId) => void
}>((set) => ({
  scheme: load(),
  setScheme: (scheme) => {
    set({ scheme })
    try {
      localStorage.setItem(STORAGE_KEY, scheme)
    } catch {
      return
    }
  },
}))
