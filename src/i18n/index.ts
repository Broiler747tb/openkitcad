import { useEffect, useSyncExternalStore } from 'react'
import { ru } from './ru'
import { counted as englishCounted } from '../core/words'

export type Language = 'en' | 'ru'
export const LANGUAGE_STORAGE_KEY = 'okc.language.v1'
const listeners = new Set<() => void>()
let language: Language | undefined
const patterns = Object.entries(ru)
  .filter(([key]) => /\{\d+\}/.test(key))
  .sort(([a], [b]) => b.length - a.length)
  .map(([key, text]) => {
    const indices: number[] = []
    const expression = key
      .split(/(\{\d+\})/)
      .map((part) => {
        if (/^\{\d+\}$/.test(part)) {
          indices.push(Number(part.slice(1, -1)))
          return '([\\s\\S]*?)'
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      })
      .join('')
    return { expression: new RegExp(`^${expression}$`), indices, text }
  })

export function getLanguage(): Language {
  if (language) return language
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    language =
      saved === 'ru' || saved === 'en' ? saved : navigator.language.startsWith('ru') ? 'ru' : 'en'
  } catch {
    language = 'en'
  }
  return language
}

export function setLanguage(value: Language): void {
  language = value
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, value)
  } catch {}
  if (typeof document !== 'undefined') document.documentElement.lang = value
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLanguage(): Language {
  const value = useSyncExternalStore(subscribe, getLanguage, () => 'en' as const)
  useEffect(() => {
    document.documentElement.lang = value
  }, [value])
  return value
}

export function t(source: string | null | undefined, ...values: (string | number)[]): string {
  if (!source) return ''
  const key = source.trim()
  let translated = getLanguage() === 'ru' ? ru[key] : undefined
  if (getLanguage() === 'ru' && translated === undefined && !values.length) {
    for (const pattern of patterns) {
      const match = pattern.expression.exec(key)
      if (!match) continue
      translated = pattern.text.replace(/\{(\d+)\}/g, (token, index: string) => {
        const capture = pattern.indices.indexOf(Number(index))
        return capture < 0 ? token : match[capture + 1]
      })
      break
    }
  }
  const text = translated === undefined ? source : source.replace(key, () => translated!)
  if (!values.length) return text
  return text.replace(/\{(\d+)\}/g, (match, index: string) =>
    String(values[Number(index)] ?? match),
  )
}

export function matchesTranslation(source: string, query: string): boolean {
  return `${source} ${t(source)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
}

const plurals: Record<string, [string, string, string]> = {
  body: ['тело', 'тела', 'тел'],
  component: ['компонент', 'компонента', 'компонентов'],
  edge: ['ребро', 'ребра', 'рёбер'],
  face: ['грань', 'грани', 'граней'],
  hole: ['отверстие', 'отверстия', 'отверстий'],
  line: ['линия', 'линии', 'линий'],
  part: ['деталь', 'детали', 'деталей'],
  point: ['точка', 'точки', 'точек'],
  shape: ['тело', 'тела', 'тел'],
  step: ['шаг', 'шага', 'шагов'],
  time: ['раз', 'раза', 'раз'],
  vertex: ['вершина', 'вершины', 'вершин'],
}
const pluralRules = new Intl.PluralRules('ru')

export function counted(count: number, one: string, many?: string): string {
  const forms = getLanguage() === 'ru' ? plurals[one] : undefined
  if (!forms) return englishCounted(count, one, many)
  const category = pluralRules.select(count)
  return `${count} ${forms[category === 'one' ? 0 : category === 'few' ? 1 : 2]}`
}
