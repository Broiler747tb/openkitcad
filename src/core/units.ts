import type { LengthUnit } from '../doc/types'

export const LENGTH_UNITS: LengthUnit[] = ['mm', 'cm', 'm', 'in', 'ft']

export const UNIT_FACTOR: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
}

export const UNIT_NAME: Record<LengthUnit, string> = {
  mm: 'Millimetres',
  cm: 'Centimetres',
  m: 'Metres',
  in: 'Inches',
  ft: 'Feet',
}

const FIELD_DECIMALS: Record<LengthUnit, number> = { mm: 4, cm: 5, m: 7, in: 4, ft: 5 }

const LABEL_DECIMALS: Record<LengthUnit, number> = { mm: 2, cm: 3, m: 5, in: 3, ft: 4 }

export function isLengthUnit(unit: string): unit is LengthUnit {
  return unit in UNIT_FACTOR
}

function rounded(value: number, decimals: number): number {
  const r = Number(value.toFixed(decimals))
  return Object.is(r, -0) ? 0 : r
}

export function lengthInUnit(mm: number, unit: LengthUnit): number {
  return rounded(mm / UNIT_FACTOR[unit], FIELD_DECIMALS[unit])
}

export function lengthText(mm: number, unit: LengthUnit): string {
  if (!Number.isFinite(mm)) return '--'
  return String(lengthInUnit(mm, unit))
}

export function lengthLabel(mm: number, unit: LengthUnit, withUnit = true): string {
  if (!Number.isFinite(mm)) return '--'
  const text = String(rounded(mm / UNIT_FACTOR[unit], LABEL_DECIMALS[unit]))
  return withUnit ? `${text} ${unit}` : text
}

export function areaLabel(mm2: number, unit: LengthUnit): string {
  const f = UNIT_FACTOR[unit]
  return `${rounded(mm2 / (f * f), LABEL_DECIMALS[unit])} ${unit}²`
}

export function volumeLabel(mm3: number, unit: LengthUnit): string {
  if (unit === 'mm') return `${rounded(mm3 / 1000, 1)} cm³`
  const f = UNIT_FACTOR[unit]
  return `${rounded(mm3 / (f * f * f), LABEL_DECIMALS[unit])} ${unit}³`
}
