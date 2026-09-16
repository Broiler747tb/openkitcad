import { quantity } from '../../core/quantity'
import { isLengthUnit, UNIT_FACTOR } from '../../core/units'
import type { LengthUnit } from '../../doc/types'

export type VariableResolver = (name: string) => number

export const LENGTH_DECIMALS: Record<LengthUnit, number> = { mm: 2, cm: 3, m: 4, in: 3, ft: 4 }

export const ANGLE_UNIT = 'deg'

const ANGLE_SUFFIXES = new Set(['deg', 'rad', '°'])
const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/
const WORD = /^(?:[a-z_][a-z0-9_]*|°)/
const MAX_INPUT = 256

function tidy(value: number): number {
  const rounded = Number(value.toPrecision(12))
  return Object.is(rounded, -0) ? 0 : rounded
}

export function rewriteLengthExpression(input: string, unit: LengthUnit): string {
  const text = input.toLowerCase()
  const opens: number[] = []
  let out = ''
  let atomStart = -1
  let atomEnded = false
  let index = 0
  while (index < text.length) {
    const char = text[index]
    const rest = text.slice(index)
    if (/\s/.test(char)) {
      out += char
      index++
      continue
    }
    const number = rest.match(NUMBER)
    if (number) {
      atomStart = out.length
      out += number[0]
      atomEnded = true
      index += number[0].length
      continue
    }
    const word = rest.match(WORD)
    if (word) {
      const name = word[0]
      index += name.length
      if (atomEnded && atomStart >= 0 && isLengthUnit(name)) {
        const factor = UNIT_FACTOR[name] / UNIT_FACTOR[unit]
        out = `${out.slice(0, atomStart)}(${out.slice(atomStart).trimEnd()}*${factor})`
        continue
      }
      if (ANGLE_SUFFIXES.has(name)) {
        throw new Error(`${name} is an angle unit. Use mm, cm, m, in or ft for a length.`)
      }
      atomStart = out.length
      out += name
      atomEnded = true
      continue
    }
    if (char === '(') {
      opens.push(out.length)
      out += char
      atomEnded = false
      atomStart = -1
    } else if (char === ')') {
      atomStart = opens.pop() ?? -1
      out += char
      atomEnded = atomStart >= 0
    } else {
      out += char
      atomEnded = false
      atomStart = -1
    }
    index++
  }
  return out
}

export function parseLength(text: string, unit: LengthUnit, variable?: VariableResolver): number {
  if (!text.trim()) throw new Error('Enter a length, such as 12 or 1.5 in.')
  if (text.length > MAX_INPUT) throw new Error('That expression is too long.')
  const scale = UNIT_FACTOR[unit]
  const resolve = variable ? (name: string) => variable(name) / scale : undefined
  const value = quantity(rewriteLengthExpression(text, unit), '', resolve) * scale
  if (!Number.isFinite(value)) throw new Error('That length is not a finite number.')
  return tidy(value)
}

export function parseAngle(text: string, variable?: VariableResolver): number {
  if (!text.trim()) throw new Error('Enter an angle, such as 45 or 0.5 rad.')
  const value = quantity(text, '°', variable)
  if (!Number.isFinite(value)) throw new Error('That angle is not a finite number.')
  return tidy(value)
}

export function parseInteger(text: string, variable?: VariableResolver): number {
  if (!text.trim()) throw new Error('Enter a whole number.')
  const value = quantity(text, '', variable)
  const rounded = Math.round(value)
  if (Math.abs(value - rounded) > 1e-9) throw new Error('Enter a whole number.')
  return rounded
}

export function formatNumber(value: number, decimals: number): string {
  const fixed = Number(value.toFixed(decimals))
  return String(Object.is(fixed, -0) ? 0 : fixed)
}

export function convertLength(value: number, from: LengthUnit, to: LengthUnit): number {
  return (value * UNIT_FACTOR[from]) / UNIT_FACTOR[to]
}

export function formatLength(
  millimetres: number,
  unit: LengthUnit,
  decimals: number = LENGTH_DECIMALS[unit],
): string {
  return `${formatNumber(millimetres / UNIT_FACTOR[unit], decimals)} ${unit}`
}

export function formatAngle(degrees: number, decimals = 2): string {
  return `${formatNumber(degrees, decimals)} ${ANGLE_UNIT}`
}

export function formatInteger(value: number): string {
  return String(Math.round(value))
}
