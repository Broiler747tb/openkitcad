import { create } from 'zustand'
import type { PartCategory, PartFilters } from '../../catalogue'

const FAVOURITES = 'openkitcad.parts.favourites.v1'
const RECENT = 'openkitcad.parts.recent.v1'

export const RECENT_LIMIT = 8

function read(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function write(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids))
  } catch {
    return
  }
}

interface ShelfState {
  favourites: string[]
  recent: string[]
  version: number
  toggleFavourite: (id: string) => void
  noteUsed: (id: string) => void
  forget: (id: string) => void
  replace: (favourites: string[], recent: string[]) => void
  changed: () => void
}

export const useShelf = create<ShelfState>((set, get) => ({
  favourites: read(FAVOURITES),
  recent: read(RECENT),
  version: 0,
  toggleFavourite(id) {
    const current = get().favourites
    const favourites = current.includes(id) ? current.filter((f) => f !== id) : [id, ...current]
    write(FAVOURITES, favourites)
    set({ favourites })
  },
  noteUsed(id) {
    const recent = [id, ...get().recent.filter((r) => r !== id)].slice(0, RECENT_LIMIT)
    write(RECENT, recent)
    set({ recent })
  },
  forget(id) {
    const favourites = get().favourites.filter((f) => f !== id)
    const recent = get().recent.filter((r) => r !== id)
    write(FAVOURITES, favourites)
    write(RECENT, recent)
    set({ favourites, recent })
  },
  replace(favourites, recent) {
    write(FAVOURITES, favourites)
    write(RECENT, recent)
    set({ favourites, recent })
  },
  changed() {
    set({ version: get().version + 1 })
  },
}))

export type PartsView =
  | { kind: 'home' }
  | { kind: 'type'; category: PartCategory }
  | { kind: 'details'; partId: string; back: PartsView }
  | { kind: 'mine' }

export interface MakerRequest {
  mode: 'new' | 'edit' | 'copy'
  partId?: string
}

interface PartsViewState {
  query: string
  filters: PartFilters
  view: PartsView
  picker: string | null
  maker: MakerRequest | null
  setQuery: (query: string) => void
  setFilters: (filters: PartFilters) => void
  show: (view: PartsView) => void
  openPicker: (family: string | null) => void
  openMaker: (maker: MakerRequest | null) => void
}

export const usePartsView = create<PartsViewState>((set) => ({
  query: '',
  filters: {},
  view: { kind: 'home' },
  picker: null,
  maker: null,
  setQuery: (query) => set({ query }),
  setFilters: (filters) => set({ filters }),
  show: (view) => set({ view }),
  openPicker: (picker) => set({ picker }),
  openMaker: (maker) => set({ maker }),
}))
