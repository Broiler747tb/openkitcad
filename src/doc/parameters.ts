import { quantity } from '../core/quantity'
import type { Feature, OkcDocument, Parameter } from './types'

const fields = [
  'width',
  'height',
  'depth',
  'radius',
  'diameter',
  'distance',
  'thickness',
  'angle',
  'cornerRadius',
  'draftAngle',
  'outerDiameter',
  'boreDiameter',
  'boreDepth',
  'counterboreDiameter',
  'counterboreDepth',
  'countersinkAngle',
  'gap',
  'length',
  'hookDepth',
  'inset',
  'bead',
  'flankAngle',
  'clearance',
]

export function parameterFields(f: Feature): string[] {
  return fields.filter((key) => typeof (f as unknown as Record<string, unknown>)[key] === 'number')
}

export function parameterValues(parameters: Parameter[]): Map<string, number> {
  if (parameters.length > 128) throw new Error('Maximum 128 parameters per document.')
  const source = new Map<string, Parameter>()
  const values = new Map<string, number>()
  const visiting = new Set<string>()
  for (const p of parameters) {
    if (
      !/^[a-z_][a-z0-9_]*$/.test(p.name) ||
      ['pi', 'mm', 'cm', 'm', 'in', 'deg', 'rad'].includes(p.name)
    )
      throw new Error(
        `Invalid parameter name: ${p.name}. Use lowercase letters, digits and underscores.`,
      )
    if (source.has(p.name)) throw new Error(`Duplicate parameter: ${p.name}`)
    source.set(p.name, p)
  }
  const resolve = (name: string): number => {
    if (values.has(name)) return values.get(name)!
    if (visiting.has(name))
      throw new Error(`Cyclic parameter dependency: ${[...visiting, name].join(' → ')}`)
    const p = source.get(name)
    if (!p) throw new Error(`Unknown parameter: ${name}`)
    visiting.add(name)
    const value = p.expression === undefined ? p.value : quantity(p.expression, 'mm', resolve)
    if (!Number.isFinite(value) || Math.abs(value) > 1e6)
      throw new Error(`Parameter ${name} is outside the finite ±1,000,000 range.`)
    visiting.delete(name)
    values.set(name, value)
    return value
  }
  for (const name of source.keys()) resolve(name)
  return values
}

export function resolveParameters(doc: OkcDocument, dropMissing = false): void {
  const values = parameterValues(doc.parameters)
  const read = (name: string) => {
    if (!values.has(name)) throw new Error(`Unknown parameter: ${name}`)
    return values.get(name)!
  }
  const byId = new Map(doc.timeline.map((feature) => [feature.id, feature]))
  const writes: Array<{ feature: Feature; field: string; value: number }> = []
  const seen = new Set<string>()
  const links = doc.bindings ?? []
  for (const link of links) {
    const feature = byId.get(link.featureId)
    if (!feature) {
      if (dropMissing) continue
      throw new Error('A parameter link targets a missing feature.')
    }
    if (!parameterFields(feature).includes(link.field))
      throw new Error(`Unsupported linked field: ${link.field}`)
    const key = `${link.featureId}/${link.field}`
    if (seen.has(key)) throw new Error(`Duplicate link: ${link.field}`)
    seen.add(key)
    const isAngle = link.field.toLowerCase().includes('angle')
    const value = quantity(link.expression, isAngle ? '°' : 'mm', read)
    const zeroAllowed = [
      'cornerRadius',
      'draftAngle',
      'boreDiameter',
      'boreDepth',
      'gap',
      'inset',
      'clearance',
    ].includes(link.field)
    const signed =
      (feature.kind === 'extrude' && link.field === 'distance') ||
      ((feature.kind === 'box' || feature.kind === 'cylinder') && link.field === 'height')
    if (
      Math.abs(value) > 1e6 ||
      (!isAngle && (signed ? value === 0 : zeroAllowed ? value < 0 : value <= 0))
    )
      throw new Error(`Invalid dimension for ${feature.name}.${link.field}: ${value}`)
    writes.push({ feature, field: link.field, value })
  }
  for (const p of doc.parameters) p.value = values.get(p.name)!
  for (const w of writes) (w.feature as unknown as Record<string, unknown>)[w.field] = w.value
  if (dropMissing) doc.bindings = links.filter((link) => byId.has(link.featureId))
}
