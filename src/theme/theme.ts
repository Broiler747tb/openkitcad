import { useSyncExternalStore } from 'react'

export type ThemeName = 'light' | 'dark'
export type ThemePreference = ThemeName | 'system'

export interface ThemeSnapshot {
  theme: ThemeName
  preference: ThemePreference
}

export type ThemeListener = (theme: ThemeName, preference: ThemePreference) => void

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>

export const THEME_STORAGE_KEY = 'okc.theme.v1'
export const THEME_ATTRIBUTE = 'data-theme'
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'light'
export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system']
export const THEME_LABEL: Record<ThemePreference, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'Match the system',
}

const listeners = new Set<ThemeListener>()
let current: ThemePreference | null = null
let snapshot: ThemeSnapshot | null = null
let query: MediaQueryList | null = null
let watching = false

export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
    ? value
    : DEFAULT_THEME_PREFERENCE
}

function browserStorage(): ThemeStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadThemePreference(storage: ThemeStorage | null = browserStorage()) {
  try {
    return normalizeThemePreference(storage?.getItem(THEME_STORAGE_KEY))
  } catch {
    return DEFAULT_THEME_PREFERENCE
  }
}

export function saveThemePreference(
  preference: ThemePreference,
  storage: ThemeStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, preference)
  } catch {}
}

function darkQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  query ??= window.matchMedia('(prefers-color-scheme: dark)')
  return query
}

export function systemPrefersDark(): boolean {
  return darkQuery()?.matches ?? false
}

export function resolveTheme(
  preference: ThemePreference,
  prefersDark: boolean = systemPrefersDark(),
): ThemeName {
  if (preference === 'system') return prefersDark ? 'dark' : 'light'
  return preference
}

function documentRoot(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.documentElement
}

export function applyThemePreference(
  preference: ThemePreference,
  root: Element | null = documentRoot(),
): ThemeName {
  if (root) {
    if (preference === 'system') root.removeAttribute(THEME_ATTRIBUTE)
    else root.setAttribute(THEME_ATTRIBUTE, preference)
  }
  return resolveTheme(preference)
}

export function getThemePreference(): ThemePreference {
  current ??= loadThemePreference()
  return current
}

export function getTheme(): ThemeName {
  return resolveTheme(getThemePreference())
}

function notify() {
  snapshot = null
  const preference = getThemePreference()
  const theme = resolveTheme(preference)
  for (const listener of [...listeners]) listener(theme, preference)
}

function onSystemChange() {
  if (getThemePreference() === 'system') notify()
}

function watchSystem() {
  if (watching) return
  const media = darkQuery()
  if (!media || typeof media.addEventListener !== 'function') return
  media.addEventListener('change', onSystemChange)
  watching = true
}

export function initTheme(root: Element | null = documentRoot()): ThemeName {
  current = loadThemePreference()
  watchSystem()
  const theme = applyThemePreference(current, root)
  notify()
  return theme
}

export function setTheme(
  preference: ThemePreference,
  storage: ThemeStorage | null = browserStorage(),
): ThemeName {
  current = normalizeThemePreference(preference)
  saveThemePreference(current, storage)
  const theme = applyThemePreference(current)
  notify()
  return theme
}

export function toggleTheme(): ThemeName {
  return setTheme(getTheme() === 'dark' ? 'light' : 'dark')
}

export function subscribeTheme(listener: ThemeListener): () => void {
  listeners.add(listener)
  watchSystem()
  return () => {
    listeners.delete(listener)
  }
}

export function readToken(name: string, element: Element | null = documentRoot()): string {
  if (!element || typeof getComputedStyle !== 'function') return ''
  return getComputedStyle(element).getPropertyValue(name).trim()
}

const serverSnapshot: ThemeSnapshot = { theme: 'light', preference: DEFAULT_THEME_PREFERENCE }

function subscribeStore(onChange: () => void) {
  return subscribeTheme(() => onChange())
}

function readSnapshot(): ThemeSnapshot {
  snapshot ??= { theme: getTheme(), preference: getThemePreference() }
  return snapshot
}

export function useTheme(): ThemeSnapshot & {
  setTheme: typeof setTheme
  toggleTheme: typeof toggleTheme
} {
  const value = useSyncExternalStore(subscribeStore, readSnapshot, () => serverSnapshot)
  return { ...value, setTheme, toggleTheme }
}
