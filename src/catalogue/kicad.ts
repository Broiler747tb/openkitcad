import type { Vec2 } from '../core/math'
import type { Bump, CataloguePart, Connector, MountingHole, PartCategory } from './types'
import { slugify } from './userParts'

type Sx = string | Sx[]

export interface KicadFootprint {
  key: string
  ref: string
  value: string
  name: string
  back: boolean
  box: [number, number, number, number]
  height: number
  reason: string
  edge: boolean
}

export interface KicadBoard {
  name: string
  thickness: number
  width: number
  depth: number
  outline:
    | { shape: 'rect'; w: number; h: number; cornerRadius?: number }
    | { shape: 'poly'; points: Vec2[] }
  holes: MountingHole[]
  footprints: KicadFootprint[]
  warnings: string[]
}

export interface KicadChoices {
  name: string
  category: PartCategory
  connectors: ReadonlySet<string>
  heights: Readonly<Record<string, number>>
}

const JOIN = 0.01
const EDGE = 1

function parse(text: string): Sx[] {
  const stack: Sx[][] = [[]]
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (c === '(') {
      const list: Sx[] = []
      stack[stack.length - 1].push(list)
      stack.push(list)
      i++
    } else if (c === ')') {
      if (stack.length > 1) stack.pop()
      i++
    } else if (c === '"') {
      let out = ''
      i++
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) {
          const next = text[i + 1]
          out += next === 'n' ? '\n' : next
          i += 2
        } else {
          out += text[i++]
        }
      }
      stack[stack.length - 1].push(out)
      i++
    } else if (c === ' ' || c === '\n' || c === '\r' || c === '\t') {
      i++
    } else {
      let j = i
      while (j < n && !' \n\r\t()"'.includes(text[j])) j++
      stack[stack.length - 1].push(text.slice(i, j))
      i = j
    }
  }
  const top = stack[0][0]
  if (!Array.isArray(top)) throw new Error('This is not a KiCad board file.')
  return top
}

function isList(node: Sx): node is Sx[] {
  return Array.isArray(node)
}

function child(node: Sx[], name: string): Sx[] | undefined {
  return node.find((item): item is Sx[] => isList(item) && item[0] === name)
}

function children(node: Sx[], name: string): Sx[][] {
  return node.filter((item): item is Sx[] => isList(item) && item[0] === name)
}

function num(node: Sx[] | undefined, index: number, fallback = 0): number {
  const value = node ? Number(node[index]) : NaN
  return Number.isFinite(value) ? value : fallback
}

function point(node: Sx[] | undefined): Vec2 | null {
  return node ? [num(node, 1), num(node, 2)] : null
}

function layerOf(node: Sx[]): string {
  const layer = child(node, 'layer')
  return layer ? String(layer[1]) : ''
}

function arcPoints(start: Vec2, mid: Vec2, end: Vec2): Vec2[] {
  const [ax, ay] = start
  const [bx, by] = mid
  const [cx, cy] = end
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (Math.abs(d) < 1e-9) return [start, end]
  const ux =
    ((ax * ax + ay * ay) * (by - cy) +
      (bx * bx + by * by) * (cy - ay) +
      (cx * cx + cy * cy) * (ay - by)) /
    d
  const uy =
    ((ax * ax + ay * ay) * (cx - bx) +
      (bx * bx + by * by) * (ax - cx) +
      (cx * cx + cy * cy) * (bx - ax)) /
    d
  const radius = Math.hypot(ax - ux, ay - uy)
  const a0 = Math.atan2(ay - uy, ax - ux)
  const a1 = Math.atan2(by - uy, bx - ux)
  const a2 = Math.atan2(cy - uy, cx - ux)
  const turn = (from: number, to: number) => {
    let delta = to - from
    while (delta <= -Math.PI) delta += 2 * Math.PI
    while (delta > Math.PI) delta -= 2 * Math.PI
    return delta
  }
  let sweep = turn(a0, a1) + turn(a1, a2)
  if (Math.abs(turn(a0, a1)) + Math.abs(turn(a1, a2)) > Math.abs(sweep) + 1e-6) {
    sweep = sweep > 0 ? sweep - 2 * Math.PI : sweep + 2 * Math.PI
  }
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 18)))
  const out: Vec2[] = []
  for (let k = 0; k <= steps; k++) {
    const angle = a0 + (sweep * k) / steps
    out.push([ux + radius * Math.cos(angle), uy + radius * Math.sin(angle)])
  }
  out[0] = start
  out[out.length - 1] = end
  return out
}

function oldArc(centre: Vec2, start: Vec2, degrees: number): Vec2[] {
  const radius = Math.hypot(start[0] - centre[0], start[1] - centre[1])
  const a0 = Math.atan2(start[1] - centre[1], start[0] - centre[0])
  const sweep = (degrees * Math.PI) / 180
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 18)))
  const out: Vec2[] = []
  for (let k = 0; k <= steps; k++) {
    const angle = a0 + (sweep * k) / steps
    out.push([centre[0] + radius * Math.cos(angle), centre[1] + radius * Math.sin(angle)])
  }
  return out
}

function circlePoints(centre: Vec2, radius: number): Vec2[] {
  return Array.from({ length: 48 }, (_, k) => {
    const angle = (k / 48) * Math.PI * 2
    return [centre[0] + radius * Math.cos(angle), centre[1] + radius * Math.sin(angle)] as Vec2
  })
}

interface Shape {
  points: Vec2[]
  closed: boolean
  radius?: number
}

function shapeOf(node: Sx[]): Shape | null {
  const kind = String(node[0]).replace(/^(gr|fp)_/, '')
  const start = point(child(node, 'start'))
  const end = point(child(node, 'end'))
  if (kind === 'line' && start && end) return { points: [start, end], closed: false }
  if (kind === 'rect' && start && end) {
    return {
      points: [start, [end[0], start[1]], end, [start[0], end[1]]],
      closed: true,
    }
  }
  if (kind === 'circle') {
    const centre = point(child(node, 'center'))
    if (!centre || !end) return null
    return {
      points: circlePoints(centre, Math.hypot(end[0] - centre[0], end[1] - centre[1])),
      closed: true,
    }
  }
  if (kind === 'arc' && start && end) {
    const mid = point(child(node, 'mid'))
    if (mid) {
      const points = arcPoints(start, mid, end)
      return { points, closed: false, radius: arcRadius(start, mid, end) }
    }
    const angle = child(node, 'angle')
    if (!angle) return null
    return {
      points: oldArc(start, end, num(angle, 1)),
      closed: false,
      radius: Math.hypot(end[0] - start[0], end[1] - start[1]),
    }
  }
  if (kind === 'poly') {
    const pts = child(node, 'pts')
    const points = pts ? children(pts, 'xy').map((xy) => [num(xy, 1), num(xy, 2)] as Vec2) : []
    return points.length >= 3 ? { points, closed: true } : null
  }
  if (kind === 'curve') {
    const pts = child(node, 'pts')
    const control = pts ? children(pts, 'xy').map((xy) => [num(xy, 1), num(xy, 2)] as Vec2) : []
    if (control.length !== 4) return null
    const points: Vec2[] = []
    for (let k = 0; k <= 16; k++) {
      const t = k / 16
      const s = 1 - t
      points.push([
        s * s * s * control[0][0] +
          3 * s * s * t * control[1][0] +
          3 * s * t * t * control[2][0] +
          t * t * t * control[3][0],
        s * s * s * control[0][1] +
          3 * s * s * t * control[1][1] +
          3 * s * t * t * control[2][1] +
          t * t * t * control[3][1],
      ])
    }
    return { points, closed: false }
  }
  return null
}

function arcRadius(a: Vec2, b: Vec2, c: Vec2): number {
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1])
  const bc = Math.hypot(c[0] - b[0], c[1] - b[1])
  const ca = Math.hypot(a[0] - c[0], a[1] - c[1])
  const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
  return area > 1e-9 ? (ab * bc * ca) / (4 * area) : 0
}

function close(a: Vec2, b: Vec2): boolean {
  return Math.abs(a[0] - b[0]) < JOIN && Math.abs(a[1] - b[1]) < JOIN
}

function area(points: readonly Vec2[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i]
    const [x1, y1] = points[(i + 1) % points.length]
    sum += x0 * y1 - x1 * y0
  }
  return sum / 2
}

function loops(shapes: Shape[]): Vec2[][] {
  const out: Vec2[][] = shapes.filter((shape) => shape.closed).map((shape) => shape.points)
  const open = shapes.filter((shape) => !shape.closed).map((shape) => [...shape.points])
  while (open.length) {
    const chain = open.shift()!
    let grown = true
    while (grown && !close(chain[0], chain[chain.length - 1])) {
      grown = false
      for (let k = 0; k < open.length; k++) {
        const next = open[k]
        const tail = chain[chain.length - 1]
        if (close(next[0], tail)) chain.push(...next.slice(1))
        else if (close(next[next.length - 1], tail)) chain.push(...next.slice(0, -1).reverse())
        else continue
        open.splice(k, 1)
        grown = true
        break
      }
    }
    if (chain.length > 3 && close(chain[0], chain[chain.length - 1])) out.push(chain.slice(0, -1))
  }
  return out
}

function rotate([x, y]: Vec2, degrees: number): Vec2 {
  const angle = (degrees * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [x * cos + y * sin, y * cos - x * sin]
}

const HEIGHTS: Array<[RegExp, number, string]> = [
  [/USB_C/i, 3.3, 'USB-C socket'],
  [/USB_Micro|Micro_?USB/i, 3, 'micro USB socket'],
  [/USB_Mini|Mini_?USB/i, 4, 'mini USB socket'],
  [/USB_A/i, 7, 'USB-A socket'],
  [/USB_B/i, 11, 'USB-B socket'],
  [/RJ45|8P8C/i, 13.5, 'RJ45 jack'],
  [/RJ1[12]|6P[46]C/i, 11.5, 'RJ11 jack'],
  [/HDMI.*(Micro|Mini)|(Micro|Mini).*HDMI/i, 3.5, 'small HDMI socket'],
  [/HDMI/i, 6.5, 'HDMI socket'],
  [/SD_?Card|Micro_?SD|TF_?Card/i, 2, 'SD card slot'],
  [/Barrel|DC_?Jack|Power_?Jack/i, 11, 'barrel jack'],
  [/Jack_3\.5|Audio_?Jack|PJ-3/i, 5.5, 'audio jack'],
  [/TerminalBlock/i, 10, 'terminal block'],
  [/JST_XH/i, 7, 'JST XH'],
  [/JST_(PH|EH)/i, 6, 'JST PH or EH'],
  [/JST_(SH|GH)|JST_ZH/i, 4.3, 'JST SH, GH or ZH'],
  [/JST_VH/i, 9.5, 'JST VH'],
  [/Molex_KK/i, 12, 'Molex KK'],
  [/PicoBlade/i, 3.5, 'Molex PicoBlade'],
  [/Micro-?Fit/i, 9.9, 'Molex Micro-Fit'],
  [/(PinHeader|PinSocket).*Horizontal/i, 2.5, 'right-angle header'],
  [/IDC|BoxHeader/i, 9, 'boxed header'],
  [/PinHeader|PinSocket/i, 8.5, 'pin header'],
  [/Relay/i, 15.5, 'relay'],
  [/Buzzer/i, 9.5, 'buzzer'],
  [/TO-220.*Horizontal/i, 4.6, 'TO-220 lying down'],
  [/TO-220/i, 16, 'TO-220'],
  [/TO-92/i, 5, 'TO-92'],
  [/TO-263|D2PAK/i, 4.8, 'D2PAK'],
  [/TO-252|DPAK/i, 2.4, 'DPAK'],
  [/SOT-223/i, 1.8, 'SOT-223'],
  [/SOT-?\d|SC-70/i, 1.1, 'SOT package'],
  [/QFN|DFN|WSON|SON-/i, 1, 'QFN package'],
  [/QFP/i, 1.6, 'QFP package'],
  [/BGA/i, 1.5, 'BGA package'],
  [/SOIC|SSOP|TSSOP|MSOP|SOP-/i, 1.75, 'SOIC package'],
  [/DIP-/i, 5, 'DIP package'],
  [/HC-?49.*SMD/i, 4, 'HC-49 crystal'],
  [/HC-?49/i, 13.5, 'HC-49 crystal'],
  [/Crystal_SMD|Oscillator_SMD/i, 1, 'SMD crystal'],
  [/Crystal/i, 4, 'crystal'],
  [/SW_Push.*6x6|SW_PUSH_6mm/i, 5, 'tactile switch'],
  [/SW_DIP/i, 5, 'DIP switch'],
  [/SW_|Button|Tactile/i, 3.5, 'switch'],
  [/LED_D5/i, 8.6, '5 mm LED'],
  [/LED_D3/i, 5.3, '3 mm LED'],
  [/WS2812|SK6812|5050/i, 1.6, 'RGB LED'],
  [/LED_/i, 0.8, 'SMD LED'],
  [/CR2032|Battery/i, 5, 'battery holder'],
  [/Potentiometer|Trimmer/i, 5, 'potentiometer'],
  [/ESP32|WROOM|WROVER/i, 3.2, 'ESP32 module'],
  [/ESP-?(12|07)/i, 3, 'ESP8266 module'],
  [/C_Radial|C_Disc|C_Rect/i, 6, 'through-hole capacitor'],
  [/L_Radial|L_Toroid/i, 10, 'through-hole inductor'],
  [/R_Axial|DO-41|DO-35|D_Axial/i, 3, 'axial part'],
  [/SMA|SMB|SMC|SOD-|MELF/i, 1.2, 'SMD diode'],
  [/Fuse/i, 1.5, 'fuse'],
  [/_(0201|0402)/, 0.4, 'tiny passive'],
  [/_0603/, 0.5, '0603 passive'],
  [/_0805/, 0.6, '0805 passive'],
  [/_(1206|1210|2010|2512)/, 0.7, 'large passive'],
  [/^L_|Inductor/i, 3, 'SMD inductor'],
]

export function guessHeight(name: string, value = ''): { height: number; reason: string } {
  const text = `${name} ${value}`
  const tall = /_H(\d+(?:\.\d+)?)mm/i.exec(text)
  if (tall) return { height: Number(tall[1]), reason: 'height in the footprint name' }
  const can = /CP_Elec_\d+(?:\.\d+)?x(\d+(?:\.\d+)?)/i.exec(text)
  if (can) return { height: Number(can[1]), reason: 'can size in the footprint name' }
  const radial = /CP_Radial_D(\d+(?:\.\d+)?)mm/i.exec(text)
  if (radial) {
    return { height: Math.round((Number(radial[1]) * 1.4 + 1) * 10) / 10, reason: 'can diameter' }
  }
  const short = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name
  for (const [pattern, height, reason] of HEIGHTS) {
    if (pattern.test(short) || pattern.test(value)) return { height, reason }
  }
  return { height: 2, reason: 'no match, so 2 mm' }
}

function screwFor(name: string, drill: number): string {
  const named = /_M(\d+(?:\.\d+)?)/i.exec(name)
  if (named) return `M${named[1]}`
  if (drill <= 2.4) return 'M2'
  if (drill <= 2.95) return 'M2.5'
  if (drill <= 3.6) return 'M3'
  if (drill <= 4.6) return 'M4'
  return 'M5'
}

function textOf(footprint: Sx[], kind: 'Reference' | 'Value'): string {
  const property = footprint.find(
    (item): item is Sx[] => isList(item) && item[0] === 'property' && item[1] === kind,
  )
  if (property) return String(property[2] ?? '')
  const text = footprint.find(
    (item): item is Sx[] => isList(item) && item[0] === 'fp_text' && item[1] === kind.toLowerCase(),
  )
  return text ? String(text[2] ?? '') : ''
}

export function readKicadBoard(text: string, fileName = 'board.kicad_pcb'): KicadBoard {
  const root = parse(text)
  if (root[0] !== 'kicad_pcb') throw new Error('This is not a KiCad board file.')
  const warnings: string[] = []
  const thickness = num(child(child(root, 'general') ?? [], 'thickness'), 1, 1.6)
  const fileLabel = fileName.replace(/\.kicad_pcb$/i, '')
  const edges = root
    .filter((item): item is Sx[] => isList(item) && /^gr_/.test(String(item[0])))
    .filter((item) => layerOf(item) === 'Edge.Cuts')
    .map(shapeOf)
    .filter((shape): shape is Shape => !!shape)
  const footprints = root.filter(
    (item): item is Sx[] => isList(item) && (item[0] === 'footprint' || item[0] === 'module'),
  )
  const placed = footprints.map((footprint) => {
    const at = child(footprint, 'at')
    const origin: Vec2 = [num(at, 1), num(at, 2)]
    const angle = num(at, 3)
    const place = (local: Vec2): Vec2 => {
      const [x, y] = rotate(local, angle)
      return [origin[0] + x, origin[1] + y]
    }
    return { footprint, origin, angle, place }
  })
  for (const { footprint, place } of placed) {
    for (const item of footprint) {
      if (!isList(item) || !/^fp_/.test(String(item[0])) || layerOf(item) !== 'Edge.Cuts') continue
      const shape = shapeOf(item)
      if (shape) edges.push({ ...shape, points: shape.points.map(place) })
    }
  }
  const outer = loops(edges).sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))[0]
  let outline: Vec2[]
  if (outer) {
    outline = outer
  } else {
    const all = edges.flatMap((shape) => shape.points)
    if (all.length) {
      warnings.push(
        'The board edge is not closed, so its outline is the box round the Edge.Cuts lines.',
      )
    } else {
      warnings.push(
        'There is no board edge on Edge.Cuts, so the outline is the box round the parts.',
      )
      for (const { origin } of placed) all.push(origin)
    }
    if (!all.length) throw new Error('This board file has no outline and no parts.')
    const xs = all.map((p) => p[0])
    const ys = all.map((p) => p[1])
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    outline = [
      [x0 - (edges.length ? 0 : EDGE), y0 - (edges.length ? 0 : EDGE)],
      [x1 + (edges.length ? 0 : EDGE), y0 - (edges.length ? 0 : EDGE)],
      [x1 + (edges.length ? 0 : EDGE), y1 + (edges.length ? 0 : EDGE)],
      [x0 - (edges.length ? 0 : EDGE), y1 + (edges.length ? 0 : EDGE)],
    ]
  }
  const minX = Math.min(...outline.map((p) => p[0]))
  const maxX = Math.max(...outline.map((p) => p[0]))
  const minY = Math.min(...outline.map((p) => p[1]))
  const maxY = Math.max(...outline.map((p) => p[1]))
  const width = maxX - minX
  const depth = maxY - minY
  const board = (p: Vec2): Vec2 => [
    Math.round((p[0] - minX) * 1000) / 1000,
    Math.round((maxY - p[1]) * 1000) / 1000,
  ]
  const filled = Math.abs(area(outline)) / (width * depth)
  const radii = edges.map((shape) => shape.radius ?? 0).filter((radius) => radius > 0)
  const shape: KicadBoard['outline'] =
    filled > 0.985
      ? {
          shape: 'rect',
          w: Math.round(width * 1000) / 1000,
          h: Math.round(depth * 1000) / 1000,
          ...(radii.length ? { cornerRadius: Math.round(Math.max(...radii) * 100) / 100 } : {}),
        }
      : { shape: 'poly', points: outline.map(board) }

  const holes: MountingHole[] = []
  const parts: KicadFootprint[] = []
  for (const { footprint, place, origin } of placed) {
    const name = String(footprint[1] ?? '')
    const ref = textOf(footprint, 'Reference')
    const value = textOf(footprint, 'Value')
    const back = layerOf(footprint).startsWith('B.')
    const pads = children(footprint, 'pad')
    const drilled = pads
      .map((pad) => ({ pad, drill: num(child(pad, 'drill'), 1) }))
      .filter((entry) => entry.drill > 0)
    const mounting =
      /Mounting_?Hole/i.test(name) ||
      (pads.length > 0 &&
        pads.every((pad) => pad[2] === 'np_thru_hole') &&
        drilled.some((entry) => entry.drill >= 2))
    if (mounting) {
      const widest = drilled.sort((a, b) => b.drill - a.drill)[0]
      const at = widest ? point(child(widest.pad, 'at')) : null
      const [x, y] = board(at ? place(at) : origin)
      const diameter = widest?.drill ?? 3.2
      holes.push({ id: `h${holes.length + 1}`, x, y, diameter, screw: screwFor(name, diameter) })
      continue
    }
    const courtyard: Vec2[] = []
    for (const item of footprint) {
      if (!isList(item) || !/^fp_/.test(String(item[0]))) continue
      if (!/CrtYd/.test(layerOf(item))) continue
      const outlineShape = shapeOf(item)
      if (outlineShape) courtyard.push(...outlineShape.points.map(place))
    }
    if (!courtyard.length) {
      for (const pad of pads) {
        const at = point(child(pad, 'at'))
        const size = child(pad, 'size')
        if (!at) continue
        const reach = Math.hypot(num(size, 1), num(size, 2)) / 2
        for (const corner of [
          [-reach, -reach],
          [reach, -reach],
          [reach, reach],
          [-reach, reach],
        ] as Vec2[]) {
          courtyard.push(place([at[0] + corner[0], at[1] + corner[1]]))
        }
      }
    }
    if (!courtyard.length) continue
    const inBoard = courtyard.map(board)
    const xs = inBoard.map((p) => p[0])
    const ys = inBoard.map((p) => p[1])
    const box: [number, number, number, number] = [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    ]
    if (box[2] - box[0] < 0.05 || box[3] - box[1] < 0.05) continue
    const guess = guessHeight(name, value)
    const label = ref || `?${parts.length + 1}`
    let key = label
    for (let n = 2; parts.some((part) => part.key === key); n++) key = `${label}#${n}`
    parts.push({
      key,
      ref: label,
      value,
      name,
      back,
      box,
      height: guess.height,
      reason: guess.reason,
      edge: Math.min(box[0], box[1], width - box[2], depth - box[3]) < EDGE,
    })
  }
  const title = child(child(root, 'title_block') ?? [], 'title')
  const name = (title && String(title[1] ?? '').trim()) || fileLabel || 'KiCad board'
  return { name, thickness, width, depth, outline: shape, holes, footprints: parts, warnings }
}

function sideOf(box: KicadFootprint['box'], width: number, depth: number): Connector['side'] {
  const gaps: Array<[Connector['side'], number]> = [
    ['-x', box[0]],
    ['+x', width - box[2]],
    ['-y', box[1]],
    ['+y', depth - box[3]],
  ]
  return gaps.sort((a, b) => a[1] - b[1])[0][0]
}

const COLOURS = { connector: '#8b9096', chip: '#20262c', header: '#111417', other: '#3a3f45' }

function colourOf(footprint: KicadFootprint, connector: boolean): string {
  if (/PinHeader|PinSocket|IDC/i.test(footprint.name)) return COLOURS.header
  if (connector) return COLOURS.connector
  if (/^U/i.test(footprint.ref)) return COLOURS.chip
  return COLOURS.other
}

export function kicadPart(board: KicadBoard, choices: KicadChoices, id: string): CataloguePart {
  const { width, depth, thickness } = board
  const round = (value: number) => Math.round(value * 1000) / 1000
  const bumps: Bump[] = []
  const connectors: Connector[] = []
  const used = new Set<string>()
  for (const footprint of board.footprints) {
    const height = choices.heights[footprint.key] ?? footprint.height
    if (!(height > 0)) continue
    const [x0, y0, x1, y1] = footprint.box
    const z = footprint.back ? -height : thickness
    const connector = choices.connectors.has(footprint.key)
    bumps.push({
      x: round(x0),
      y: round(y0),
      w: round(x1 - x0),
      h: round(y1 - y0),
      z: round(z),
      height: round(height),
      colour: colourOf(footprint, connector),
      label: [footprint.ref, footprint.value].filter(Boolean).join(' '),
    })
    if (!connector) continue
    const side = sideOf(footprint.box, width, depth)
    const along = side === '-x' || side === '+x'
    let slug = slugify(footprint.ref) || 'connector'
    for (let n = 2; used.has(slug); n++) slug = `${slugify(footprint.ref)}-${n}`
    used.add(slug)
    connectors.push({
      id: slug,
      label: [footprint.ref, footprint.value].filter(Boolean).join(' '),
      side,
      x: round(side === '-x' ? 0 : side === '+x' ? width : (x0 + x1) / 2),
      y: round(side === '-y' ? 0 : side === '+y' ? depth : (y0 + y1) / 2),
      z: round(z),
      width: round(along ? y1 - y0 : x1 - x0),
      height: round(height),
      protrusion: round(
        Math.max(
          0,
          side === '-x' ? -x0 : side === '+x' ? x1 - width : side === '-y' ? -y0 : y1 - depth,
        ),
      ),
    })
  }
  return {
    id,
    name: choices.name.trim() || board.name,
    category: choices.category,
    summary: `${round(width)} x ${round(depth)} mm board imported from KiCad. Outline and holes are exact; component heights are estimates.`,
    geometry: {
      kind: 'board',
      outline: board.outline,
      thickness,
      ...(bumps.length ? { bumps } : {}),
    },
    ...(board.holes.length ? { mountingHoles: board.holes } : {}),
    ...(connectors.length ? { connectors } : {}),
    tags: ['kicad', 'imported'],
    confidence: 'approximate',
    source:
      'Imported from a KiCad board file: outline, thickness and holes come from the file; component heights are guessed from footprint names.',
  }
}
