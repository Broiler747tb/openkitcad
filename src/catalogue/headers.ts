import type { Bump, CataloguePart, Keepout, LookComponent, PinHeader } from './types'

export const HEADER_HEIGHT = 8.5

const PLASTIC = '#1b1d20'

function isHeader(component: LookComponent): boolean {
  return component.kind === 'header' || (component.kind === 'box' && !!component.header)
}

interface Area {
  x: number
  y: number
  w: number
  h: number
}

function rowArea(row: PinHeader): Area {
  const pitch = row.pitch ?? 2.54
  return {
    x: row.x - pitch / 2,
    y: row.y - pitch / 2,
    w: row.cols * pitch,
    h: row.rows * pitch,
  }
}

function overlaps(a: Area, b: Area): boolean {
  return (
    a.x < b.x + b.w - 1e-6 &&
    a.x + a.w > b.x + 1e-6 &&
    a.y < b.y + b.h - 1e-6 &&
    a.y + a.h > b.y + 1e-6
  )
}

export function headersFitted(part: CataloguePart): boolean {
  if (part.geometry.kind !== 'board') return false
  return (
    (part.look?.components ?? []).some(isHeader) ||
    (part.geometry.bumps ?? []).some((bump) => bump.header) ||
    (part.keepouts ?? []).some((keepout) => keepout.header)
  )
}

export function hasHeaderChoice(part: CataloguePart): boolean {
  return part.geometry.kind === 'board' && (!!part.pinHeaders?.length || headersFitted(part))
}

export function withHeaders(part: CataloguePart, fitted: boolean | undefined): CataloguePart {
  const g = part.geometry
  if (fitted === undefined || g.kind !== 'board') return part
  const components = part.look?.components
  if (!fitted) {
    if (!headersFitted(part)) return part
    return {
      ...part,
      geometry: { ...g, bumps: g.bumps?.filter((bump) => !bump.header) },
      keepouts: part.keepouts?.filter((keepout) => !keepout.header),
      look: part.look && {
        ...part.look,
        components: components?.filter((component) => !isHeader(component)),
      },
    }
  }
  const taken: Area[] = [
    ...(g.bumps ?? []).filter((bump) => bump.header),
    ...(part.keepouts ?? []).filter((keepout) => keepout.header),
  ]
  const bare = (part.pinHeaders ?? []).filter(
    (row) =>
      !(components ?? []).some(
        (component) =>
          component.kind === 'header' &&
          Math.abs(component.x - row.x) < 0.05 &&
          Math.abs(component.y - row.y) < 0.05,
      ) && !taken.some((area) => overlaps(rowArea(row), area)),
  )
  if (!bare.length) return part
  const onTop = part.category === 'sbc'
  const headers: LookComponent[] = bare.map((row) => ({
    kind: 'header',
    x: row.x,
    y: row.y,
    rows: row.rows,
    cols: row.cols,
    pitch: row.pitch ?? 2.54,
    height: HEADER_HEIGHT,
    ...(onTop ? {} : { flip: true }),
    label: row.label,
  }))
  const bumps: Bump[] = onTop
    ? bare.map((row) => ({
        ...rowArea(row),
        z: g.thickness,
        height: HEADER_HEIGHT,
        colour: PLASTIC,
        label: row.label,
        header: true,
      }))
    : []
  const keepouts: Keepout[] = onTop
    ? []
    : bare.map((row) => ({
        id: `k-header-${row.id}`,
        label: 'Header pins below',
        ...rowArea(row),
        z: -HEADER_HEIGHT,
        height: HEADER_HEIGHT,
        header: true,
      }))
  return {
    ...part,
    geometry: bumps.length ? { ...g, bumps: [...(g.bumps ?? []), ...bumps] } : g,
    keepouts: keepouts.length ? [...(part.keepouts ?? []), ...keepouts] : part.keepouts,
    look: components ? { ...part.look, components: [...components, ...headers] } : part.look,
  }
}
