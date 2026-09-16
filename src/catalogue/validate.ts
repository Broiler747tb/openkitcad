import { CATEGORY_ORDER } from './search'
import type { CataloguePart } from './types'

const GEOMETRY_FIELDS: Record<CataloguePart['geometry']['kind'], string[]> = {
  board: ['thickness'],
  extrusion: ['size', 'length'],
  screw: ['diameter', 'length', 'headDiameter', 'headHeight'],
  insert: ['outerDiameter', 'length', 'pilotDiameter'],
  standoff: ['length', 'acrossFlats'],
  motor: [
    'frame',
    'bodyLength',
    'shaftDiameter',
    'shaftLength',
    'bossDiameter',
    'bossHeight',
    'boltSpacing',
  ],
  bearing: ['innerDiameter', 'outerDiameter', 'width'],
  connector: ['bodyWidth', 'bodyHeight', 'bodyDepth'],
}

const CONFIDENCE = ['datasheet', 'measured', 'approximate']

function positive(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function finite(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value)
}

function text(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

export function partProblems(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return ['This is not a part. A part file holds one JSON object.']
  const part = value as Record<string, any>
  const problems: string[] = []
  if (!text(part.id) || !/^[a-z0-9][a-z0-9-]*$/.test(part.id))
    problems.push('"id" has to be lower-case letters, digits and dashes.')
  if (!text(part.name)) problems.push('"name" is missing.')
  if (!CATEGORY_ORDER.includes(part.category))
    problems.push(`"category" has to be one of ${CATEGORY_ORDER.join(', ')}.`)
  if (typeof part.summary !== 'string') problems.push('"summary" is missing.')
  if (!CONFIDENCE.includes(part.confidence))
    problems.push('"confidence" has to be datasheet, measured or approximate.')
  if (typeof part.source !== 'string') problems.push('"source" is missing.')
  if (
    part.popularity !== undefined &&
    !(finite(part.popularity) && part.popularity >= 0 && part.popularity <= 100)
  )
    problems.push('"popularity" has to be a number from 0 to 100.')
  for (const key of ['family', 'variant', 'manufacturer'])
    if (part[key] !== undefined && typeof part[key] !== 'string')
      problems.push(`"${key}" has to be text.`)

  const g = part.geometry
  const kind = g && typeof g === 'object' ? (g.kind as keyof typeof GEOMETRY_FIELDS) : undefined
  const fields = kind ? GEOMETRY_FIELDS[kind] : undefined
  if (!fields) {
    problems.push(`"geometry.kind" has to be one of ${Object.keys(GEOMETRY_FIELDS).join(', ')}.`)
  } else {
    for (const key of fields)
      if (!positive(g[key])) problems.push(`"geometry.${key}" has to be a number above zero.`)
    if (kind === 'board') {
      const outline = g.outline
      if (outline?.shape === 'rect') {
        if (!positive(outline.w) || !positive(outline.h))
          problems.push('"geometry.outline" needs "w" and "h" above zero.')
      } else if (outline?.shape === 'poly') {
        const points = outline.points
        if (
          !Array.isArray(points) ||
          points.length < 3 ||
          !points.every((p: unknown) => Array.isArray(p) && p.length === 2 && p.every(finite))
        )
          problems.push('"geometry.outline.points" needs at least three [x, y] pairs.')
      } else {
        problems.push('"geometry.outline.shape" has to be rect or poly.')
      }
      if (
        g.bumps !== undefined &&
        (!Array.isArray(g.bumps) ||
          !g.bumps.every(
            (bump: any) =>
              bump &&
              finite(bump.x) &&
              finite(bump.y) &&
              finite(bump.z) &&
              positive(bump.w) &&
              positive(bump.h) &&
              positive(bump.height),
          ))
      )
        problems.push('"geometry.bumps" need x, y, z and a size above zero.')
    }
    if (kind === 'connector') {
      const cutout = g.cutout
      const rect = cutout?.shape === 'rect' && positive(cutout.w) && positive(cutout.h)
      const circle = cutout?.shape === 'circle' && positive(cutout.d)
      if (!rect && !circle)
        problems.push('"geometry.cutout" needs a rect with "w" and "h", or a circle with "d".')
      if (!(finite(g.protrusion) && g.protrusion >= 0))
        problems.push('"geometry.protrusion" has to be zero or more.')
    }
  }

  if (
    part.mountingHoles !== undefined &&
    (!Array.isArray(part.mountingHoles) ||
      !part.mountingHoles.every(
        (hole: any) => hole && finite(hole.x) && finite(hole.y) && positive(hole.diameter),
      ))
  )
    problems.push('"mountingHoles" need "x", "y" and a "diameter" above zero.')
  for (const key of ['keepouts', 'connectors', 'pinHeaders', 'links', 'tags'])
    if (part[key] !== undefined && !Array.isArray(part[key]))
      problems.push(`"${key}" has to be a list.`)
  return problems
}

export function readPartFile(text: string): { parts: CataloguePart[]; problems: string[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { parts: [], problems: ['This file is not valid JSON.'] }
  }
  const candidates = Array.isArray(parsed) ? parsed : [parsed]
  const parts: CataloguePart[] = []
  const problems: string[] = []
  candidates.forEach((candidate, index) => {
    const found = partProblems(candidate)
    if (!found.length) {
      parts.push(candidate as CataloguePart)
      return
    }
    const name =
      candidate && typeof candidate === 'object' && typeof (candidate as any).name === 'string'
        ? `"${(candidate as any).name}"`
        : `Part ${index + 1}`
    problems.push(`${name}: ${found[0]}`)
  })
  return { parts, problems }
}
