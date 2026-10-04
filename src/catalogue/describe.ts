import { lengthLabel } from '../core/units'
import { counted, t } from '../i18n'
import type { LengthUnit } from '../doc/types'
import { partBounds } from './placement'
import type { CataloguePart } from './types'

export interface PartFact {
  label: string
  value: string
}

function sizes(values: number[], units: LengthUnit): string {
  return `${values.map((value) => lengthLabel(value, units, false)).join(' × ')} ${units}`
}

function spread(values: number[]): number {
  return Math.max(...values) - Math.min(...values)
}

function distinct(values: number[]): number {
  return new Set(values.map((value) => Math.round(value * 100))).size
}

export function sizeSummary(part: CataloguePart, units: LengthUnit): string {
  const [x0, y0, z0, x1, y1, z1] = partBounds(part)
  return sizes([x1 - x0, y1 - y0, z1 - z0], units)
}

export function holeSummary(part: CataloguePart, units: LengthUnit): string | null {
  const holes = part.mountingHoles ?? []
  if (!holes.length) return null
  const screws = [...new Set(holes.map((hole) => hole.screw).filter(Boolean))]
  const count = counted(holes.length, 'hole')
  const fits = screws.length ? t('{0} for {1}', count, screws.join(t(' and '))) : count
  if (holes.length === 2) {
    const [a, b] = holes
    return t('{0}, {1} apart', fits, lengthLabel(Math.hypot(a.x - b.x, a.y - b.y), units))
  }
  const xs = holes.map((hole) => hole.x)
  const ys = holes.map((hole) => hole.y)
  if (holes.length === 4 && distinct(xs) === 2 && distinct(ys) === 2)
    return t('{0}, {1} apart', fits, sizes([spread(xs), spread(ys)], units))
  return fits
}

function tally(labels: string[]): string {
  const counts = new Map<string, number>()
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
  return [...counts].map(([label, n]) => (n > 1 ? `${n} × ${label}` : label)).join(', ')
}

function geometryFacts(part: CataloguePart, units: LengthUnit): PartFact[] {
  const g = part.geometry
  const mm = (value: number) => lengthLabel(value, units)
  switch (g.kind) {
    case 'connector':
      return [
        {
          label: 'Panel hole',
          value:
            g.cutout.shape === 'circle'
              ? `⌀ ${mm(g.cutout.d)}`
              : sizes([g.cutout.w, g.cutout.h], units),
        },
        ...(g.panelThickness ? [{ label: 'Panel up to', value: mm(g.panelThickness) }] : []),
      ]
    case 'screw':
      return [
        { label: 'Thread', value: `${g.thread} × ${mm(g.length)}` },
        { label: 'Head', value: `${t(g.head)}, ⌀ ${mm(g.headDiameter)}` },
      ]
    case 'insert':
      return [
        { label: 'Thread', value: g.thread },
        { label: 'Pilot hole', value: `⌀ ${mm(g.pilotDiameter)}` },
      ]
    case 'standoff':
      return [
        { label: 'Thread', value: `${g.thread}, ${t(g.style.replace('-', ' to '))}` },
        { label: 'Across flats', value: mm(g.acrossFlats) },
      ]
    case 'motor':
      return [
        { label: 'Frame', value: mm(g.frame) },
        { label: 'Shaft', value: `⌀ ${mm(g.shaftDiameter)} × ${mm(g.shaftLength)}` },
      ]
    case 'bearing':
      return [
        {
          label: 'Bore × outside',
          value: t('{0}, {1} wide', sizes([g.innerDiameter, g.outerDiameter], units), mm(g.width)),
        },
      ]
    case 'extrusion':
      return [
        {
          label: 'Profile',
          value: t('{0}, {1} slots', sizes([g.size, g.depth ?? g.size], units), g.slots ?? 4),
        },
      ]
    case 'rod':
      return [
        { label: 'Shaft', value: `⌀ ${mm(g.diameter)} × ${mm(g.length)}` },
        ...(g.spec ? [{ label: 'Type', value: g.spec }] : []),
      ]
    case 'board':
      return []
  }
}

export function partFacts(part: CataloguePart, units: LengthUnit): PartFact[] {
  const facts: PartFact[] = [{ label: 'Size', value: sizeSummary(part, units) }]
  facts.push(...geometryFacts(part, units))
  const holes = holeSummary(part, units)
  if (holes) facts.push({ label: 'Mounting', value: holes })
  if (part.connectors?.length && part.geometry.kind !== 'connector')
    facts.push({ label: 'Ports', value: tally(part.connectors.map((c) => c.label)) })
  if (part.pinHeaders?.length)
    facts.push({
      label: 'Headers',
      value: part.pinHeaders
        .map(
          (header) =>
            `${header.label}, ${header.rows} × ${header.cols}${header.pitch !== 2.54 ? ` at ${lengthLabel(header.pitch, units)}` : ''}`,
        )
        .join('; '),
    })
  const power = part.electrical
  if (power?.voltage?.length || power?.currentPeak != null || power?.currentTypical != null) {
    const parts = [
      power.voltage?.length ? `${power.voltage.join(t(' or '))} ${t('V')}` : '',
      power.currentPeak != null
        ? t('up to {0} A', power.currentPeak)
        : power.currentTypical != null
          ? t('about {0} A', power.currentTypical)
          : '',
    ].filter(Boolean)
    facts.push({ label: 'Power', value: parts.join(', ') })
  }
  return facts
}
