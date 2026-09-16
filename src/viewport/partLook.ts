import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type {
  CataloguePart,
  Finish,
  LookComponent,
  LookFacing,
  PartGeometry,
  PortStyle,
} from '../catalogue/types'

type Geometry<K extends PartGeometry['kind']> = Extract<PartGeometry, { kind: K }>
type Component<K extends LookComponent['kind']> = Extract<LookComponent, { kind: K }>

export interface LookMesh {
  geometry: THREE.BufferGeometry
  edges: THREE.BufferGeometry | null
  finish: Finish
  colour: string
}

export interface LookPrototype {
  key: string
  meshes: LookMesh[]
  box: THREE.Box3
}

export const FINISHES: Record<
  Finish,
  {
    roughness: number
    metalness: number
    env: number
    opacity?: number
    edges: boolean
    colour: string
  }
> = {
  pcb: { roughness: 0.5, metalness: 0.05, env: 0.35, edges: true, colour: '#1f6f4a' },
  plastic: { roughness: 0.55, metalness: 0, env: 0.3, edges: true, colour: '#25282c' },
  metal: { roughness: 0.3, metalness: 0.85, env: 1, edges: true, colour: '#c7ccd1' },
  gold: { roughness: 0.28, metalness: 1, env: 1, edges: false, colour: '#d6b04a' },
  brass: { roughness: 0.34, metalness: 0.9, env: 1, edges: true, colour: '#c9a24a' },
  chip: { roughness: 0.75, metalness: 0.05, env: 0.2, edges: true, colour: '#1c1e21' },
  glass: { roughness: 0.06, metalness: 0.3, env: 1, edges: true, colour: '#0b0e12' },
  rubber: { roughness: 0.92, metalness: 0, env: 0.05, edges: true, colour: '#1a1b1d' },
  anodised: { roughness: 0.42, metalness: 0.55, env: 0.7, edges: true, colour: '#2b2f34' },
  translucent: {
    roughness: 0.2,
    metalness: 0,
    env: 0.5,
    opacity: 0.72,
    edges: false,
    colour: '#e23b3b',
  },
}

const BOARD_COLOUR: Record<CataloguePart['category'], string> = {
  sbc: '#1f6f4a',
  mcu: '#1c6f8c',
  connector: '#1f6f4a',
  display: '#1b3f8a',
  sensor: '#1f55a0',
  power: '#1f4f8a',
  fastener: '#1f6f4a',
  extrusion: '#1f6f4a',
  motor: '#1f6f4a',
  motion: '#1f6f4a',
  control: '#1f6f4a',
}

const DARK = '#0c0d0f'
const TAU = Math.PI * 2

class Look {
  private groups = new Map<
    string,
    { finish: Finish; colour: string; parts: THREE.BufferGeometry[] }
  >()
  private frames: THREE.Matrix4[] = []

  within(matrix: THREE.Matrix4, draw: () => void) {
    const parent = this.frames.at(-1)
    this.frames.push(parent ? parent.clone().multiply(matrix) : matrix)
    draw()
    this.frames.pop()
  }

  add(finish: Finish, colour: string | undefined, geometry: THREE.BufferGeometry) {
    const frame = this.frames.at(-1)
    if (frame) geometry.applyMatrix4(frame)
    const flat = geometry.index ? geometry.toNonIndexed() : geometry
    if (flat !== geometry) geometry.dispose()
    for (const name of Object.keys(flat.attributes))
      if (name !== 'position' && name !== 'normal') flat.deleteAttribute(name)
    if (!flat.getAttribute('normal')) flat.computeVertexNormals()
    const tint = colour ?? FINISHES[finish].colour
    const key = `${finish}|${tint}`
    const group = this.groups.get(key) ?? { finish, colour: tint, parts: [] }
    group.parts.push(flat)
    this.groups.set(key, group)
  }

  box(
    finish: Finish,
    colour: string | undefined,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    height: number,
    radius = 0,
  ) {
    if (!(w > 0 && h > 0 && height > 0)) return
    const r = Math.min(radius, w / 2, h / 2, height / 2) * 0.999
    const geometry =
      r > 0.02 ? new RoundedBoxGeometry(w, h, height, 2, r) : new THREE.BoxGeometry(w, h, height)
    geometry.translate(x + w / 2, y + h / 2, z + height / 2)
    this.add(finish, colour, geometry)
  }

  cylinder(
    finish: Finish,
    colour: string | undefined,
    cx: number,
    cy: number,
    z: number,
    d: number,
    height: number,
    segments = 28,
    top = d,
  ) {
    if (!(d > 0 && height > 0)) return
    const geometry = new THREE.CylinderGeometry(top / 2, d / 2, height, segments)
    geometry.rotateX(Math.PI / 2)
    geometry.translate(cx, cy, z + height / 2)
    this.add(finish, colour, geometry)
  }

  cylinderY(
    finish: Finish,
    colour: string | undefined,
    cx: number,
    y: number,
    cz: number,
    d: number,
    length: number,
    segments = 28,
    front = d,
  ) {
    if (!(d > 0 && length > 0)) return
    const geometry = new THREE.CylinderGeometry(front / 2, d / 2, length, segments)
    geometry.translate(cx, y + length / 2, cz)
    this.add(finish, colour, geometry)
  }

  extrude(
    finish: Finish,
    colour: string | undefined,
    shape: THREE.Shape,
    z: number,
    height: number,
    curveSegments = 24,
  ) {
    if (!(height > 0)) return
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: height,
      bevelEnabled: false,
      curveSegments,
    })
    geometry.translate(0, 0, z)
    this.add(finish, colour, geometry)
  }

  prismY(
    finish: Finish,
    colour: string | undefined,
    shape: THREE.Shape,
    y: number,
    depth: number,
    curveSegments = 16,
  ) {
    if (!(depth > 0)) return
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: false,
      curveSegments,
    })
    geometry.rotateX(Math.PI / 2)
    geometry.rotateZ(Math.PI)
    geometry.translate(0, y, 0)
    this.add(finish, colour, geometry)
  }

  lathe(
    finish: Finish,
    colour: string | undefined,
    cx: number,
    cy: number,
    z: number,
    profile: Array<[number, number]>,
    segments = 32,
  ) {
    const geometry = new THREE.LatheGeometry(
      profile.map(([r, h]) => new THREE.Vector2(Math.max(r, 0.0001), h)),
      segments,
    )
    geometry.rotateX(Math.PI / 2)
    geometry.translate(cx, cy, z)
    this.add(finish, colour, geometry)
  }

  plate(
    finish: Finish,
    colour: string | undefined,
    shape: THREE.Shape,
    z: number,
    facingDown = false,
  ) {
    const geometry = new THREE.ShapeGeometry(shape, 24)
    if (facingDown) geometry.scale(1, 1, -1)
    geometry.translate(0, 0, z)
    this.add(finish, colour, geometry)
  }

  build(key: string): LookPrototype {
    const meshes: LookMesh[] = []
    const box = new THREE.Box3()
    for (const group of this.groups.values()) {
      const geometry =
        group.parts.length === 1 ? group.parts[0] : mergeGeometries(group.parts, false)
      if (group.parts.length > 1) for (const part of group.parts) part.dispose()
      if (!geometry) continue
      geometry.computeBoundingBox()
      geometry.computeBoundingSphere()
      box.union(geometry.boundingBox!)
      meshes.push({
        geometry,
        edges: FINISHES[group.finish].edges ? new THREE.EdgesGeometry(geometry, 35) : null,
        finish: group.finish,
        colour: group.colour,
      })
    }
    return { key, meshes, box }
  }
}

function roundedRect<T extends THREE.Path>(
  path: T,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): T {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2) * 0.999)
  if (radius <= 0.01) {
    path.moveTo(x, y)
    path.lineTo(x + w, y)
    path.lineTo(x + w, y + h)
    path.lineTo(x, y + h)
    path.lineTo(x, y)
    return path
  }
  path.moveTo(x + radius, y)
  path.lineTo(x + w - radius, y)
  path.absarc(x + w - radius, y + radius, radius, -Math.PI / 2, 0, false)
  path.lineTo(x + w, y + h - radius)
  path.absarc(x + w - radius, y + h - radius, radius, 0, Math.PI / 2, false)
  path.lineTo(x + radius, y + h)
  path.absarc(x + radius, y + h - radius, radius, Math.PI / 2, Math.PI, false)
  path.lineTo(x, y + radius)
  path.absarc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5, false)
  return path
}

function circle<T extends THREE.Path>(path: T, cx: number, cy: number, r: number): T {
  path.absarc(cx, cy, r, 0, TAU, false)
  return path
}

function polygon<T extends THREE.Path>(path: T, points: Array<[number, number]>): T {
  points.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)))
  path.closePath()
  return path
}

function regular<T extends THREE.Path>(
  path: T,
  cx: number,
  cy: number,
  circumradius: number,
  sides: number,
  turn = 0,
): T {
  return polygon(
    path,
    Array.from({ length: sides }, (_, i) => {
      const a = turn + (i * TAU) / sides
      return [cx + circumradius * Math.cos(a), cy + circumradius * Math.sin(a)] as [number, number]
    }),
  )
}

function facingFrame(x: number, y: number, z: number, facing: LookFacing): THREE.Matrix4 {
  const turn =
    facing === '+x' ? Math.PI / 2 : facing === '+y' ? Math.PI : facing === '-x' ? -Math.PI / 2 : 0
  return new THREE.Matrix4().makeRotationZ(turn).setPosition(x, y, z)
}

function flipFrame(cy: number, z: number): THREE.Matrix4 {
  return new THREE.Matrix4()
    .makeTranslation(0, cy, z)
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI))
    .multiply(new THREE.Matrix4().makeTranslation(0, -cy, -z))
}

const PORT_SIZE: Record<PortStyle, [number, number, number]> = {
  'usb-c': [8.94, 3.26, 7.35],
  'micro-usb': [7.5, 2.5, 5.3],
  'mini-usb': [7.7, 3.9, 9.2],
  'usb-a': [13.14, 5.7, 14.3],
  'usb-a-stack': [13.14, 15.6, 17.5],
  'usb-b': [12, 10.9, 16.3],
  hdmi: [15, 5.6, 11.3],
  'micro-hdmi': [6.8, 3.4, 8],
  'mini-hdmi': [11.2, 3.2, 7.5],
  rj45: [16, 13.5, 21.3],
  'jack-35': [6, 5, 12],
  barrel: [9, 11, 14],
  microsd: [11.5, 1.5, 11],
  sd: [27, 2.6, 28],
  ffc: [22.4, 2.5, 5.6],
}

function mouthPoints(style: PortStyle, w: number, h: number): Array<[number, number]> {
  const x = w / 2
  switch (style) {
    case 'micro-usb':
      return [
        [-x, h],
        [x, h],
        [x, h * 0.45],
        [x - 0.9, 0],
        [-x + 0.9, 0],
        [-x, h * 0.45],
      ]
    case 'mini-usb':
      return [
        [-x, h],
        [x, h],
        [x, h * 0.5],
        [x - 0.8, 0],
        [-x + 0.8, 0],
        [-x, h * 0.5],
      ]
    case 'hdmi':
    case 'micro-hdmi':
    case 'mini-hdmi':
      return [
        [-x, h],
        [x, h],
        [x, h * 0.42],
        [x - w * 0.14, 0],
        [-x + w * 0.14, 0],
        [-x, h * 0.42],
      ]
    case 'usb-b':
      return [
        [-x, 0],
        [x, 0],
        [x, h * 0.74],
        [x - w * 0.2, h],
        [-x + w * 0.2, h],
        [-x, h * 0.74],
      ]
    default:
      return [
        [-x, 0],
        [x, 0],
        [x, h],
        [-x, h],
      ]
  }
}

function mouth<T extends THREE.Path>(
  path: T,
  style: PortStyle,
  w: number,
  h: number,
  inset: number,
): T {
  if (style === 'usb-c')
    return roundedRect(path, -w / 2 + inset, inset, w - 2 * inset, h - 2 * inset, h / 2 - inset)
  const sx = (w - 2 * inset) / w
  const sz = (h - 2 * inset) / h
  return polygon(
    path,
    mouthPoints(style, w, h).map(([x, z]) => [x * sx, h / 2 + (z - h / 2) * sz]),
  )
}

function drawPort(
  look: Look,
  style: PortStyle,
  w: number,
  h: number,
  depth: number,
  accent?: string,
) {
  const wall = Math.max(0.2, Math.min(w, h) * 0.06)
  switch (style) {
    case 'usb-c':
    case 'micro-usb':
    case 'mini-usb':
    case 'usb-a':
    case 'usb-b':
    case 'hdmi':
    case 'micro-hdmi':
    case 'mini-hdmi': {
      const recess = Math.min(depth * 0.45, style === 'usb-a' ? 9 : style === 'usb-b' ? 8 : 4)
      const shell = mouth(new THREE.Shape(), style, w, h, 0)
      shell.holes.push(mouth(new THREE.Path(), style, w, h, wall))
      look.prismY('metal', undefined, shell, 0, depth)
      look.prismY(
        'plastic',
        DARK,
        mouth(new THREE.Shape(), style, w, h, wall),
        recess,
        depth - recess,
      )
      if (style === 'usb-c')
        look.box(
          'plastic',
          '#15171a',
          -(w - 3.2) / 2,
          recess * 0.3,
          h / 2 - 0.35,
          w - 3.2,
          recess * 0.7,
          0.7,
        )
      else if (style === 'usb-a')
        look.box(
          'plastic',
          accent ?? '#eeede6',
          -(w - 2.4) / 2,
          0.5,
          h - wall - 2.2,
          w - 2.4,
          recess - 0.5,
          1.9,
        )
      else if (style === 'usb-b')
        look.box(
          'plastic',
          accent ?? '#eeede6',
          -w * 0.3,
          0.5,
          h * 0.22,
          w * 0.6,
          recess - 0.5,
          h * 0.5,
          0.4,
        )
      else if (style === 'micro-usb' || style === 'mini-usb')
        look.box(
          'plastic',
          '#15171a',
          -(w - 2.6) / 2,
          recess * 0.3,
          h - wall - 0.9,
          w - 2.6,
          recess * 0.7,
          0.6,
        )
      else
        look.box(
          'plastic',
          '#15171a',
          -w * 0.34,
          recess * 0.3,
          h * 0.42,
          w * 0.68,
          recess * 0.7,
          Math.max(0.5, h * 0.18),
        )
      return
    }
    case 'usb-a-stack': {
      const gap = h * 0.08
      const each = (h - gap) / 2
      const shell = roundedRect(new THREE.Shape(), -w / 2, 0, w, h, 0.3)
      for (const z0 of [0, each + gap])
        shell.holes.push(
          roundedRect(new THREE.Path(), -w / 2 + wall, z0 + wall, w - 2 * wall, each - 2 * wall, 0),
        )
      look.prismY('metal', undefined, shell, 0, 9)
      look.box('metal', undefined, -w / 2, 9, 0, w, depth - 9, h)
      for (const z0 of [0, each + gap]) {
        look.box('plastic', DARK, -w / 2 + wall, 8.5, z0 + wall, w - 2 * wall, 0.5, each - 2 * wall)
        look.box(
          'plastic',
          accent ?? '#141619',
          -(w - 2.4) / 2,
          0.5,
          z0 + each - wall - 2.2,
          w - 2.4,
          8,
          1.9,
        )
      }
      return
    }
    case 'rj45': {
      look.box('metal', undefined, -w / 2, 0, 0, w, depth, h, 0.3)
      const ow = w * 0.73
      const oh = h * 0.6
      const oz = h * 0.12
      const opening = polygon(new THREE.Shape(), [
        [-ow / 2, oz + oh * 0.28],
        [-ow * 0.18, oz + oh * 0.28],
        [-ow * 0.18, oz],
        [ow * 0.18, oz],
        [ow * 0.18, oz + oh * 0.28],
        [ow / 2, oz + oh * 0.28],
        [ow / 2, oz + oh],
        [-ow / 2, oz + oh],
      ])
      look.prismY('plastic', DARK, opening, -0.06, 0.05)
      look.box('translucent', '#39d06b', -w / 2 + 0.8, -0.3, h - 2.2, 2.4, 0.3, 1.4)
      look.box('translucent', '#ffb02e', w / 2 - 3.2, -0.3, h - 2.2, 2.4, 0.3, 1.4)
      return
    }
    case 'jack-35': {
      const barrel = Math.min(2.5, depth * 0.25)
      look.cylinderY('plastic', '#1b1d20', 0, 0, h / 2, Math.min(w, h), barrel, 28)
      look.box('plastic', '#1b1d20', -w / 2, barrel, 0, w, depth - barrel, h, 0.2)
      look.cylinderY('plastic', DARK, 0, -0.04, h / 2, Math.min(w, h) * 0.7, 0.05, 24)
      return
    }
    case 'barrel': {
      const front = Math.min(depth * 0.6, 9)
      const d = Math.min(w, h) * 0.7
      const face = roundedRect(new THREE.Shape(), -w / 2, 0, w, h, 0.4)
      face.holes.push(circle(new THREE.Path(), 0, h / 2, d / 2))
      look.prismY('plastic', '#1b1d20', face, 0, front)
      look.box('plastic', '#1b1d20', -w / 2, front, 0, w, depth - front, h, 0.3)
      look.prismY('plastic', DARK, circle(new THREE.Shape(), 0, h / 2, d / 2), front - 0.5, 0.5)
      look.cylinderY('metal', undefined, 0, 1, h / 2, d * 0.3, front - 1, 16)
      return
    }
    case 'microsd':
    case 'sd': {
      look.box('metal', undefined, -w / 2, 0, 0, w, depth, h, 0.1)
      look.box('plastic', DARK, -(w - 1.6) / 2, -0.05, h * 0.3, w - 1.6, 0.05, h * 0.42)
      return
    }
    case 'ffc': {
      look.box('plastic', '#1b1d20', -w / 2, 0, 0, w, depth, h * 0.7, 0.2)
      look.box(
        'plastic',
        accent ?? '#c9a46a',
        -w / 2 + 0.4,
        0,
        h * 0.7,
        w - 0.8,
        depth * 0.35,
        h * 0.3,
      )
      return
    }
  }
}

function drawHeader(look: Look, c: Component<'header'>, top: number, bottom: number) {
  const pitch = c.pitch ?? 2.54
  const z = c.z ?? top
  const height = c.height ?? 8.5
  const x0 = c.x - pitch / 2
  const y0 = c.y - pitch / 2
  const pins = Array.from({ length: c.rows * c.cols }, (_, i) => [
    c.x + (i % c.cols) * pitch,
    c.y + Math.floor(i / c.cols) * pitch,
  ])
  const stub = Math.min(bottom, z) - 2.8
  if (c.style === 'female') {
    look.box(
      'plastic',
      c.colour ?? '#1b1d20',
      x0,
      y0,
      z,
      c.cols * pitch,
      c.rows * pitch,
      height,
      0.15,
    )
    for (const [px, py] of pins) {
      look.box('plastic', DARK, px - 0.45, py - 0.45, z + height, 0.9, 0.9, 0.03)
      look.box('gold', undefined, px - 0.32, py - 0.32, stub, 0.64, 0.64, z - stub)
    }
    return
  }
  look.box('plastic', c.colour ?? '#1b1d20', x0, y0, z, c.cols * pitch, c.rows * pitch, 2.5, 0.1)
  for (const [px, py] of pins)
    look.box('gold', undefined, px - 0.32, py - 0.32, stub, 0.64, 0.64, z + height - stub)
}

function drawChip(look: Look, c: Component<'chip'>, top: number) {
  const z = c.z ?? top
  const height = c.height ?? 1
  const legs = c.legs ?? 'none'
  if (legs !== 'none') {
    const pitch = c.w < 6 && c.h < 6 ? 0.5 : 0.65
    const sides =
      legs === 'quad' ? ['x0', 'x1', 'y0', 'y1'] : c.w >= c.h ? ['y0', 'y1'] : ['x0', 'x1']
    for (const side of sides) {
      const alongX = side === 'y0' || side === 'y1'
      const along = alongX ? c.w : c.h
      const count = Math.min(60, Math.max(1, Math.floor((along - 0.8) / pitch)))
      const start = (along - (count - 1) * pitch) / 2
      for (let i = 0; i < count; i++) {
        const t = start + i * pitch
        if (alongX)
          look.box(
            'metal',
            undefined,
            c.x + t - 0.15,
            side === 'y0' ? c.y - 0.6 : c.y + c.h - 0.1,
            z,
            0.3,
            0.7,
            0.2,
          )
        else
          look.box(
            'metal',
            undefined,
            side === 'x0' ? c.x - 0.6 : c.x + c.w - 0.1,
            c.y + t - 0.15,
            z,
            0.7,
            0.3,
            0.2,
          )
      }
    }
  }
  look.box('chip', c.colour, c.x, c.y, z + (legs === 'none' ? 0 : 0.1), c.w, c.h, height, 0.08)
  const dot = Math.min(0.8, Math.min(c.w, c.h) * 0.14)
  look.cylinder(
    'plastic',
    '#3a3d42',
    c.x + dot * 1.2,
    c.y + c.h - dot * 1.2,
    z + height + (legs === 'none' ? 0 : 0.1),
    dot,
    0.02,
    12,
  )
}

function drawModule(look: Look, c: Component<'module'>, top: number) {
  const z = c.z ?? top
  const base = Math.min(0.8, c.height * 0.3)
  look.box('pcb', '#1b1e22', c.x, c.y, z, c.w, c.h, base)
  const reserve = c.antenna ? (c.antennaLength ?? 6) : 0.5
  const inset = 0.5
  let [sx, sy, sw, sh] = [c.x + inset, c.y + inset, c.w - 2 * inset, c.h - 2 * inset]
  if (c.antenna === '+y') sh = c.h - inset - reserve
  if (c.antenna === '-y') [sy, sh] = [c.y + reserve, c.h - inset - reserve]
  if (c.antenna === '+x') sw = c.w - inset - reserve
  if (c.antenna === '-x') [sx, sw] = [c.x + reserve, c.w - inset - reserve]
  look.box('metal', undefined, sx, sy, z + base, sw, sh, c.height - base, 0.3)
  if (!c.antenna || c.antenna === '+z') return
  const alongY = c.antenna === '+y' || c.antenna === '-y'
  const ax = c.antenna === '+x' ? c.x + c.w - reserve + 0.6 : c.x + 0.6
  const ay = c.antenna === '+y' ? c.y + c.h - reserve + 0.6 : c.y + 0.6
  drawAntenna(
    look,
    alongY ? c.x + 1 : ax,
    alongY ? ay : c.y + 1,
    alongY ? c.w - 2 : reserve - 1.2,
    alongY ? reserve - 1.2 : c.h - 2,
    z + base,
  )
}

function drawAntenna(look: Look, x: number, y: number, w: number, h: number, z: number) {
  const strokes = Math.max(2, Math.floor(w / 1.2))
  const step = w / strokes
  for (let i = 0; i <= strokes; i++)
    look.box('gold', undefined, x + i * step - 0.2, y, z, 0.4, h, 0.04)
  for (let i = 0; i < strokes; i++)
    look.box(
      'gold',
      undefined,
      x + i * step - 0.2,
      i % 2 ? y : y + h - 0.4,
      z,
      step + 0.4,
      0.4,
      0.04,
    )
}

function drawComponent(look: Look, c: LookComponent, top: number, bottom: number) {
  const draw = () => {
    switch (c.kind) {
      case 'box':
        look.box(
          c.finish ?? 'plastic',
          c.colour,
          c.x,
          c.y,
          c.z ?? top,
          c.w,
          c.h,
          c.height,
          c.radius ?? 0,
        )
        return
      case 'cylinder':
        look.cylinder(
          c.finish ?? 'metal',
          c.colour,
          c.x,
          c.y,
          c.z ?? top,
          c.d,
          c.height,
          32,
          c.top ?? c.d,
        )
        return
      case 'chip':
        drawChip(look, c, top)
        return
      case 'module':
        drawModule(look, c, top)
        return
      case 'header':
        drawHeader(look, c, top, bottom)
        return
      case 'port': {
        const [w, h, depth] = PORT_SIZE[c.port]
        look.within(facingFrame(c.x, c.y, c.z ?? top, c.facing === '+z' ? '-y' : c.facing), () =>
          drawPort(look, c.port, c.w ?? w, c.h ?? h, c.depth ?? depth, c.colour),
        )
        return
      }
      case 'screen': {
        const z = c.z ?? top
        const height = c.height ?? 1.4
        look.box('glass', c.colour, c.x, c.y, z, c.w, c.h, height, 0.2)
        if (c.active) {
          const [ax, ay, aw, ah] = c.active
          look.box('glass', c.backlight ?? '#101a26', ax, ay, z + height, aw, ah, 0.03)
        }
        return
      }
      case 'button': {
        const s = c.size ?? 6
        const z = c.z ?? top
        const height = c.height ?? (s >= 6 ? 5 : 2)
        look.box('metal', '#a3aab1', c.x - s / 2, c.y - s / 2, z, s, s, height * 0.55, 0.15)
        look.cylinder(
          'plastic',
          c.colour ?? '#1d1f22',
          c.x,
          c.y,
          z + height * 0.55,
          s * 0.58,
          height * 0.45,
        )
        return
      }
      case 'led': {
        const s = c.size ?? 1.6
        const z = c.z ?? top
        look.box('plastic', '#f2f0ea', c.x - s / 2, c.y - s / 4, z, s, s / 2, 0.4)
        look.box(
          'translucent',
          c.colour,
          c.x - s * 0.35,
          c.y - s * 0.2,
          z + 0.4,
          s * 0.7,
          s * 0.4,
          0.25,
        )
        return
      }
      case 'crystal':
        look.box(
          'metal',
          undefined,
          c.x,
          c.y,
          c.z ?? top,
          c.w,
          c.h,
          c.height ?? 3.5,
          Math.min(c.w, c.h) / 2,
        )
        return
      case 'capacitor': {
        const z = c.z ?? top
        look.cylinder('plastic', c.colour ?? '#1c2d5a', c.x, c.y, z, c.d, c.height - 0.3)
        look.cylinder('metal', undefined, c.x, c.y, z + c.height - 0.3, c.d - 0.5, 0.3)
        return
      }
      case 'transducer': {
        const z = c.z ?? top
        look.cylinder('metal', undefined, c.x, c.y, z, c.d, c.height, 40)
        look.cylinder('rubber', '#3b3e43', c.x, c.y, z + c.height, c.d - 1.6, 0.12, 40)
        return
      }
      case 'antenna':
        drawAntenna(look, c.x, c.y, c.w, c.h, c.z ?? top)
        return
      case 'trimmer': {
        const z = c.z ?? top
        const [w, h, height] = [c.w ?? 9.5, c.h ?? 4.8, c.height ?? 9.8]
        look.box('plastic', c.colour ?? '#2f62b8', c.x, c.y, z, w, h, height, 0.2)
        look.cylinder(
          'brass',
          undefined,
          c.x + Math.min(2, w * 0.2),
          c.y + h / 2,
          z + height,
          Math.min(2.2, h * 0.45),
          0.6,
          16,
        )
        return
      }
      case 'terminal': {
        const pitch = c.pitch ?? 5.08
        const width = c.pins * pitch
        look.within(facingFrame(c.x, c.y, c.z ?? top, c.facing === '+z' ? '-y' : c.facing), () => {
          look.box('plastic', c.colour ?? '#2c6fc9', -width / 2, 0, 0, width, 7.6, 10, 0.3)
          for (let i = 0; i < c.pins; i++) {
            const px = -width / 2 + pitch * (i + 0.5)
            look.cylinder('metal', undefined, px, 4.4, 10, 3.2, 0.4, 20)
            look.box('plastic', DARK, px - 1.2, 4.15, 10.4, 2.4, 0.5, 0.03)
            look.box('plastic', DARK, px - 1.6, -0.05, 2, 3.2, 0.05, 3.2)
          }
        })
        return
      }
      case 'jst': {
        const pitch = c.pitch ?? 2.5
        const width = (c.pins - 1) * pitch + 4.9
        const [depth, height] = [5.75, 7]
        if (c.facing === '+z') {
          const z = c.z ?? top
          look.box(
            'plastic',
            c.colour ?? '#ece6d6',
            c.x - width / 2,
            c.y - depth / 2,
            z,
            width,
            depth,
            height,
            0.15,
          )
          look.box(
            'plastic',
            DARK,
            c.x - width / 2 + 0.6,
            c.y - depth / 2 + 0.9,
            z + height,
            width - 1.2,
            depth - 1.8,
            0.03,
          )
          for (let i = 0; i < c.pins; i++)
            look.box(
              'gold',
              undefined,
              c.x - ((c.pins - 1) * pitch) / 2 + i * pitch - 0.32,
              c.y - 0.32,
              z + 1,
              0.64,
              0.64,
              height - 1.5,
            )
          return
        }
        look.within(facingFrame(c.x, c.y, c.z ?? top, c.facing), () => {
          look.box('plastic', c.colour ?? '#ece6d6', -width / 2, 0, 0, width, depth, height, 0.15)
          look.box('plastic', DARK, -width / 2 + 0.6, -0.05, 0.9, width - 1.2, 0.05, height - 1.8)
        })
        return
      }
    }
  }
  if (!('flip' in c && c.flip)) return draw()
  const centreY =
    c.kind === 'box' || c.kind === 'chip'
      ? c.y + c.h / 2
      : c.kind === 'header'
        ? c.y + ((c.rows - 1) * (c.pitch ?? 2.54)) / 2
        : c.y
  look.within(flipFrame(centreY, c.z ?? bottom), () =>
    drawComponent(look, { ...c, flip: false } as LookComponent, bottom, top),
  )
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.replace('#', '').slice(0, 6), 16)
  if (!Number.isFinite(value)) return 0.5
  return (
    (0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255)) / 255
  )
}

function boardLook(look: Look, part: CataloguePart, g: Geometry<'board'>) {
  const finish = part.look?.finish ?? 'pcb'
  const colour = part.look?.colour ?? (finish === 'pcb' ? BOARD_COLOUR[part.category] : undefined)
  const shape =
    g.outline.shape === 'rect'
      ? roundedRect(new THREE.Shape(), 0, 0, g.outline.w, g.outline.h, g.outline.cornerRadius ?? 0)
      : polygon(
          new THREE.Shape(),
          g.outline.points.map(([x, y]) => [x, y]),
        )
  for (const hole of part.mountingHoles ?? [])
    shape.holes.push(circle(new THREE.Path(), hole.x, hole.y, hole.diameter / 2))
  look.extrude(finish, colour, shape, 0, g.thickness)
  if (finish === 'pcb')
    for (const hole of part.mountingHoles ?? []) {
      const ring = new THREE.Shape()
      circle(ring, hole.x, hole.y, hole.diameter / 2 + 0.9)
      ring.holes.push(circle(new THREE.Path(), hole.x, hole.y, hole.diameter / 2))
      look.plate('gold', undefined, ring, g.thickness + 0.01)
      look.plate('gold', undefined, ring.clone(), -0.01, true)
    }
  const components = part.look?.components ?? defaultBoardComponents(part, g)
  for (const component of components) drawComponent(look, component, g.thickness, 0)
  if (!components.some((component) => component.kind === 'header'))
    drawPads(look, part, g.thickness)
}

function defaultBoardComponents(part: CataloguePart, g: Geometry<'board'>): LookComponent[] {
  const out: LookComponent[] = []
  const bumps = g.bumps ?? []
  for (const bump of bumps) {
    if (/header/i.test(bump.label ?? '')) {
      out.push({
        kind: 'header',
        x: bump.x + 1.27,
        y: bump.y + 1.27,
        z: bump.z,
        rows: Math.max(1, Math.round(bump.h / 2.54)),
        cols: Math.max(1, Math.round(bump.w / 2.54)),
        height: bump.height,
      })
      continue
    }
    const grey = /^#(8b9096|a8adb3|9aa3ad|b9c0c7)$/i.test(bump.colour)
    out.push({
      kind: 'box',
      x: bump.x,
      y: bump.y,
      z: bump.z,
      w: bump.w,
      h: bump.h,
      height: bump.height,
      colour: bump.colour,
      finish: grey ? 'metal' : luminance(bump.colour) < 0.2 ? 'chip' : 'plastic',
      radius: 0.2,
    })
  }
  return out
}

function drawPads(look: Look, part: CataloguePart, top: number) {
  for (const header of part.pinHeaders ?? []) {
    const pitch = header.pitch ?? 2.54
    for (let i = 0; i < header.rows * header.cols; i++) {
      const px = header.x + (i % header.cols) * pitch
      const py = header.y + Math.floor(i / header.cols) * pitch
      const pad = circle(new THREE.Shape(), px, py, pitch * 0.34)
      pad.holes.push(circle(new THREE.Path(), px, py, pitch * 0.18))
      look.plate('gold', undefined, pad, top + 0.01)
      look.plate('gold', undefined, pad.clone(), -0.01, true)
    }
  }
}

function knurled(cx: number, cy: number, r: number, depth: number, count: number) {
  return polygon(
    new THREE.Shape(),
    Array.from({ length: count * 2 }, (_, i) => {
      const a = (i * Math.PI) / count
      const radius = i % 2 ? r - depth : r
      return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)] as [number, number]
    }),
  )
}

function connectorLook(look: Look, part: CataloguePart, g: Geometry<'connector'>) {
  const { bodyWidth: w, bodyHeight: h, bodyDepth: d, protrusion: p } = g
  const style = part.look?.style
  const accent = part.look?.accent
  const cx = w / 2
  const cz = h / 2
  const cutW = g.cutout.shape === 'circle' ? g.cutout.d : g.cutout.w
  const cutH = g.cutout.shape === 'circle' ? g.cutout.d : g.cutout.h
  const cutShape = () =>
    g.cutout.shape === 'circle'
      ? circle(new THREE.Shape(), 0, cz, g.cutout.d / 2)
      : roundedRect(
          new THREE.Shape(),
          -g.cutout.w / 2,
          cz - g.cutout.h / 2,
          g.cutout.w,
          g.cutout.h,
          g.cutout.cornerRadius ?? 0,
        )
  const front = (draw: () => void) =>
    look.within(new THREE.Matrix4().makeRotationZ(Math.PI).setPosition(cx, d, 0), draw)
  const ahead = (draw: () => void) =>
    look.within(new THREE.Matrix4().makeTranslation(cx, 0, 0), draw)

  const ports: Record<string, PortStyle> = {
    'usb-c': 'usb-c',
    'micro-usb': 'micro-usb',
    'mini-usb': 'mini-usb',
    'usb-a': 'usb-a',
    'usb-b': 'usb-b',
    hdmi: 'hdmi',
    'micro-hdmi': 'micro-hdmi',
    rj45: 'rj45',
    'jack-35': 'jack-35',
    barrel: 'barrel',
    sd: 'sd',
    microsd: 'microsd',
  }
  const port = style ? ports[style] : undefined
  if (port) {
    front(() => drawPort(look, port, w, h, d, accent))
    if (p > 0) {
      const collar = cutShape()
      collar.holes.push(
        g.cutout.shape === 'circle'
          ? circle(new THREE.Path(), 0, cz, g.cutout.d / 2 - 0.4)
          : roundedRect(
              new THREE.Path(),
              -cutW / 2 + 0.4,
              cz - cutH / 2 + 0.4,
              cutW - 0.8,
              cutH - 0.8,
              0,
            ),
      )
      ahead(() => look.prismY('metal', undefined, collar, d, p))
    }
    return
  }

  switch (style) {
    case 'rocker': {
      look.box('plastic', '#1b1d20', 0, 0, 0, w, d, h, 0.4)
      ahead(() => {
        const bezel = roundedRect(
          new THREE.Shape(),
          -w / 2 - 0.8,
          cz - h / 2 - 0.8,
          w + 1.6,
          h + 1.6,
          1,
        )
        bezel.holes.push(
          roundedRect(new THREE.Path(), -w / 2 + 1.2, cz - h / 2 + 1.2, w - 2.4, h - 2.4, 0.4),
        )
        look.prismY('plastic', '#1b1d20', bezel, d, 2)
        look.box('plastic', '#242629', -w / 2 + 1.3, d + 1, cz, w - 2.6, p - 1, h / 2 - 1.3, 0.5)
        look.box(
          'plastic',
          '#242629',
          -w / 2 + 1.3,
          d + 1,
          cz - h / 2 + 1.3,
          w - 2.6,
          Math.max(1, p - 3.5),
          h / 2 - 1.3,
          0.5,
        )
        look.box('plastic', '#f2f0ea', -0.35, d + p + 0.01, cz + h * 0.12, 0.7, 0.05, h * 0.2)
      })
      return
    }
    case 'toggle': {
      look.box('metal', '#9aa1a8', 0, 0, 0, w, d, h, 0.3)
      ahead(() => {
        const bush = Math.min(p * 0.45, 9)
        look.cylinderY('metal', undefined, 0, d, cz, cutW, bush, 32)
        look.within(
          new THREE.Matrix4()
            .makeTranslation(0, d, cz)
            .multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 6)),
          () => look.cylinderY('metal', '#aeb4ba', 0, 0.5, 0, cutW * 1.55, 2, 6),
        )
        look.within(
          new THREE.Matrix4()
            .makeTranslation(0, d + bush, cz)
            .multiply(new THREE.Matrix4().makeRotationX(0.22)),
          () => look.cylinderY('metal', undefined, 0, 0, 0, 2.6, p - bush, 20, 3.4),
        )
      })
      return
    }
    case 'pot':
    case 'encoder': {
      if (style === 'pot') look.cylinderY('metal', '#8e959c', cx, 0, cz, Math.min(w, h), d, 40)
      else look.box('metal', '#8e959c', 0, 0, 0, w, d, h, 0.3)
      ahead(() => {
        const bush = Math.min(7, p * 0.35)
        look.cylinderY('metal', undefined, 0, d, cz, cutW, bush, 32)
        const shaft = new THREE.CylinderGeometry(3, 3, p - bush, 36)
        look.within(new THREE.Matrix4().makeTranslation(0, d + bush + (p - bush) / 2, cz), () =>
          look.add(
            style === 'pot' ? 'metal' : 'plastic',
            style === 'pot' ? '#d5d9dd' : '#2a2d31',
            shaft,
          ),
        )
        look.within(new THREE.Matrix4().makeTranslation(0, d + bush, cz), () => {
          const knurl = knurled(0, 0, 3.05, 0.25, 18)
          const geometry = new THREE.ExtrudeGeometry(knurl, {
            depth: (p - bush) * 0.55,
            bevelEnabled: false,
          })
          geometry.rotateX(-Math.PI / 2)
          geometry.translate(0, p - bush - (p - bush) * 0.55, 0)
          look.add(
            style === 'pot' ? 'metal' : 'plastic',
            style === 'pot' ? '#d5d9dd' : '#2a2d31',
            geometry,
          )
        })
      })
      return
    }
    case 'led-holder': {
      look.cylinderY('plastic', '#1b1d20', cx, 0, cz, cutW, d, 32)
      ahead(() => {
        look.cylinderY('metal', undefined, 0, d, cz, cutW + 2, 1, 32)
        look.cylinderY(
          'translucent',
          accent ?? '#e23b3b',
          0,
          d + 1,
          cz,
          5,
          Math.max(0.5, p - 3.5),
          28,
        )
        const dome = new THREE.SphereGeometry(2.5, 24, 12, 0, TAU, 0, Math.PI / 2)
        dome.translate(0, d + p - 2.5, cz)
        look.add('translucent', accent ?? '#e23b3b', dome)
      })
      return
    }
    case 'fan': {
      ahead(() => {
        const frame = roundedRect(new THREE.Shape(), -w / 2, 0, w, h, 2)
        frame.holes.push(circle(new THREE.Path(), 0, cz, cutW / 2))
        for (const [hx, hz] of [
          [-w / 2 + 4, 4],
          [w / 2 - 4, 4],
          [-w / 2 + 4, h - 4],
          [w / 2 - 4, h - 4],
        ])
          frame.holes.push(circle(new THREE.Path(), hx, hz, 1.7))
        look.prismY('plastic', '#1b1d20', frame, 0, d)
        look.cylinderY('plastic', '#202226', 0, d * 0.1, cz, cutW * 0.4, d * 0.8, 32)
        for (let i = 0; i < 7; i++) {
          const blade = new THREE.BoxGeometry(cutW * 0.28, d * 0.12, cutW * 0.12)
          blade.rotateX(0.5)
          blade.translate(cutW * 0.3, 0, 0)
          blade.rotateY((i * TAU) / 7)
          blade.translate(0, d * 0.5, cz)
          look.add('plastic', '#26292d', blade)
        }
      })
      return
    }
    case 'jst-xh':
    case 'terminal': {
      look.box(
        'plastic',
        accent ?? (style === 'terminal' ? '#2e8b57' : '#ece6d6'),
        0,
        0,
        0,
        w,
        d,
        h,
        0.3,
      )
      ahead(() => {
        const pins =
          part.look?.pins ?? Math.max(1, Math.round(w / (style === 'terminal' ? 5.08 : 2.5)))
        const pitch = w / pins
        for (let i = 0; i < pins; i++) {
          const px = -w / 2 + pitch * (i + 0.5)
          if (style === 'terminal') {
            look.box(
              'plastic',
              DARK,
              px - pitch * 0.32,
              d - 0.01,
              h * 0.2,
              pitch * 0.64,
              0.05,
              h * 0.36,
            )
            look.cylinder('metal', undefined, px, d * 0.45, h, pitch * 0.6, 0.4, 20)
            look.box(
              'plastic',
              DARK,
              px - pitch * 0.25,
              d * 0.45 - 0.2,
              h + 0.4,
              pitch * 0.5,
              0.4,
              0.03,
            )
          } else {
            look.box(
              'plastic',
              DARK,
              px - pitch * 0.38,
              d - 0.01,
              h * 0.15,
              pitch * 0.76,
              0.05,
              h * 0.7,
            )
            look.box('gold', undefined, px - 0.32, d - 3, cz - 0.32, 0.64, 3, 0.64)
          }
        }
      })
      return
    }
    case 'xt': {
      look.box('plastic', accent ?? '#e6b422', 0, 0, 0, w, d, h, 0.6)
      ahead(() => {
        const housing = polygon(new THREE.Shape(), [
          [-cutW / 2, cz - cutH / 2],
          [cutW / 2 - cutH * 0.3, cz - cutH / 2],
          [cutW / 2, cz - cutH / 2 + cutH * 0.3],
          [cutW / 2, cz + cutH / 2 - cutH * 0.3],
          [cutW / 2 - cutH * 0.3, cz + cutH / 2],
          [-cutW / 2, cz + cutH / 2],
        ])
        look.prismY('plastic', accent ?? '#e6b422', housing, d, p)
        for (const px of [-cutW * 0.25, cutW * 0.25]) {
          look.cylinderY('plastic', DARK, px, d + p, cz, cutH * 0.5, 0.05, 24)
          look.cylinderY('gold', undefined, px, d + p - 1, cz, cutH * 0.3, 1.1, 20)
        }
      })
      return
    }
    case 'iec': {
      look.box('plastic', '#1b1d20', 0, 0, 0, w, d, h, 0.6)
      ahead(() => {
        const flange = cutShape()
        const inner = polygon(new THREE.Path(), [
          [-cutW * 0.4, cz - cutH * 0.36],
          [cutW * 0.4, cz - cutH * 0.36],
          [cutW * 0.4, cz + cutH * 0.2],
          [cutW * 0.25, cz + cutH * 0.36],
          [-cutW * 0.25, cz + cutH * 0.36],
          [-cutW * 0.4, cz + cutH * 0.2],
        ])
        flange.holes.push(inner)
        look.prismY('plastic', '#1b1d20', flange, d, p)
        look.prismY(
          'plastic',
          DARK,
          polygon(new THREE.Shape(), [
            [-cutW * 0.4, cz - cutH * 0.36],
            [cutW * 0.4, cz - cutH * 0.36],
            [cutW * 0.4, cz + cutH * 0.2],
            [cutW * 0.25, cz + cutH * 0.36],
            [-cutW * 0.25, cz + cutH * 0.36],
            [-cutW * 0.4, cz + cutH * 0.2],
          ]),
          d - 4,
          0.5,
        )
        for (const [px, pz] of [
          [-cutW * 0.22, cz - cutH * 0.05],
          [cutW * 0.22, cz - cutH * 0.05],
          [0, cz + cutH * 0.2],
        ])
          look.box('metal', undefined, px - 1, d - 4, pz - 0.4, 2, 5.5, 0.8)
      })
      return
    }
    case 'banana':
    case 'gx16':
    case 'sma':
    case 'rca': {
      const metalBody = style === 'gx16' || style === 'sma'
      look.cylinderY(
        metalBody ? (style === 'sma' ? 'gold' : 'metal') : 'metal',
        undefined,
        cx,
        0,
        cz,
        Math.min(w, h) * 0.55,
        d,
        28,
      )
      ahead(() => {
        look.within(new THREE.Matrix4().makeTranslation(0, d - 2.5, cz), () => {
          const nut = regular(new THREE.Shape(), 0, 0, Math.min(w, h) * 0.55, 6, Math.PI / 6)
          const geometry = new THREE.ExtrudeGeometry(nut, { depth: 2.2, bevelEnabled: false })
          geometry.rotateX(-Math.PI / 2)
          look.add(style === 'sma' ? 'gold' : 'metal', undefined, geometry)
        })
        if (style === 'banana') {
          look.cylinderY('plastic', accent ?? '#c8322c', 0, d, cz, cutW + 2.4, p, 32, cutW + 1.4)
          look.cylinderY('metal', undefined, 0, d + p, cz, cutW * 0.55, 0.3, 24)
          look.cylinderY('plastic', DARK, 0, d + p + 0.3, cz, cutW * 0.35, 0.05, 20)
        } else if (style === 'gx16') {
          look.cylinderY('metal', undefined, 0, d, cz, cutW + 3, 2, 36)
          look.cylinderY('metal', '#b9bfc5', 0, d + 2, cz, cutW, p - 2, 36)
          look.cylinderY('plastic', DARK, 0, d + p, cz, cutW - 3, 0.05, 32)
        } else if (style === 'sma') {
          look.cylinderY('gold', undefined, 0, d, cz, cutW, p, 28)
          look.cylinderY('plastic', '#f2f0ea', 0, d + p, cz, cutW * 0.6, 0.05, 24)
          look.cylinderY('gold', undefined, 0, d + p - 1, cz, 0.9, 1.1, 12)
        } else {
          look.cylinderY('metal', undefined, 0, d, cz, cutW, p, 32)
          look.cylinderY('plastic', accent ?? '#c8322c', 0, d + p, cz, cutW * 0.72, 0.05, 28)
          look.cylinderY('plastic', DARK, 0, d + p + 0.05, cz, cutW * 0.3, 0.05, 20)
        }
      })
      return
    }
    case 'panel-jack': {
      look.cylinderY('plastic', '#1b1d20', cx, 0, cz, Math.min(w, h), d - 1, 32)
      ahead(() => {
        look.cylinderY('metal', undefined, 0, d - 1, cz, cutW + 2.5, 1, 32)
        look.cylinderY('metal', '#b9bfc5', 0, d, cz, cutW, p, 32)
        look.within(new THREE.Matrix4().makeTranslation(0, d + Math.min(p * 0.35, 2), cz), () => {
          const nut = regular(new THREE.Shape(), 0, 0, cutW * 0.78, 6, Math.PI / 6)
          const geometry = new THREE.ExtrudeGeometry(nut, {
            depth: Math.min(1.8, p * 0.4),
            bevelEnabled: false,
          })
          geometry.rotateX(-Math.PI / 2)
          look.add('metal', undefined, geometry)
        })
        look.cylinderY('plastic', DARK, 0, d + p, cz, cutW * 0.72, 0.05, 28)
        look.cylinderY('metal', '#d5d9dd', 0, d + p - 3, cz, Math.max(1, cutW * 0.25), 2.8, 12)
      })
      return
    }
    case 'usb-c-panel': {
      look.cylinderY('plastic', '#1d1f22', cx, 0, cz, Math.min(w, h), d, 40)
      ahead(() => {
        look.cylinderY('plastic', '#26292d', 0, d, cz, cutW + 6, p, 40)
        look.within(
          new THREE.Matrix4()
            .makeTranslation(0, d + p + 0.01, cz - 1.65)
            .multiply(new THREE.Matrix4().makeRotationZ(Math.PI)),
          () => drawPort(look, 'usb-c', 8.94, 3.3, Math.min(7, d + p)),
        )
      })
      return
    }
    case 'dsub': {
      look.box('plastic', '#1b1d20', w * 0.12, 0, h * 0.08, w * 0.76, d, h * 0.84, 0.4)
      ahead(() => {
        const plate = roundedRect(new THREE.Shape(), -w / 2, 0, w, h, 0.8)
        for (const hx of [-w / 2 + 3.2, w / 2 - 3.2])
          plate.holes.push(circle(new THREE.Path(), hx, cz, 1.6))
        look.prismY('metal', undefined, plate, d - 0.8, 0.8)
        const shell = polygon(new THREE.Shape(), [
          [-w * 0.34, cz + h * 0.3],
          [w * 0.34, cz + h * 0.3],
          [w * 0.29, cz - h * 0.3],
          [-w * 0.29, cz - h * 0.3],
        ])
        look.prismY('metal', undefined, shell, d, p)
        const pins = [
          ...Array.from({ length: 5 }, (_, i) => [(i - 2) * w * 0.1, cz + h * 0.12]),
          ...Array.from({ length: 4 }, (_, i) => [(i - 1.5) * w * 0.1, cz - h * 0.12]),
        ]
        for (const [px, pz] of pins) look.cylinderY('plastic', DARK, px, d + p, pz, 1.2, 0.05, 12)
      })
      return
    }
    default: {
      look.box('plastic', undefined, 0, 0, 0, w, d, h, 0.3)
      if (p > 0) ahead(() => look.prismY('metal', undefined, cutShape(), d, p))
      ahead(() => look.prismY('plastic', DARK, cutShape(), d + p, 0.05))
    }
  }
}

function fastenerLook(look: Look, part: CataloguePart) {
  const g = part.geometry
  if (g.kind === 'screw') {
    const r = g.headDiameter / 2
    const finish = part.look?.finish ?? 'metal'
    const colour = part.look?.colour
    const pitch = Math.max(0.35, g.diameter * 0.17)
    const turns = Math.max(2, Math.floor((g.length - pitch) / pitch))
    const thread: Array<[number, number]> = [
      [0, 0],
      [g.diameter / 2 - pitch * 0.6, 0],
    ]
    for (let i = 0; i < turns; i++) {
      thread.push([g.diameter / 2, pitch * (i + 0.5)])
      thread.push([g.diameter / 2 - pitch * 0.55, pitch * (i + 1)])
    }
    thread.push([g.diameter / 2, g.length], [0, g.length])
    look.lathe(finish, colour, r, r, 0, thread, 24)
    const socket = regular(new THREE.Shape(), r, r, g.diameter * 0.46, 6)
    if (g.head === 'countersunk') {
      look.cylinder(
        finish,
        colour,
        r,
        r,
        g.length - g.headHeight,
        g.diameter,
        g.headHeight,
        32,
        g.headDiameter,
      )
      look.plate('plastic', DARK, socket, g.length + 0.01)
      return
    }
    if (g.head === 'button' || g.head === 'pan') {
      const profile: Array<[number, number]> = [[0, 0]]
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * (Math.PI / 2)
        profile.push([r * Math.cos(a), g.headHeight * Math.sin(a)])
      }
      look.lathe(finish, colour, r, r, g.length, [[0, 0], [r, 0], ...profile.slice(1)], 32)
      look.plate('plastic', DARK, socket, g.length + g.headHeight + 0.01)
      return
    }
    look.lathe(
      finish,
      colour,
      r,
      r,
      g.length,
      [
        [0, 0],
        [r, 0],
        [r, g.headHeight - 0.3],
        [r - 0.3, g.headHeight],
        [0, g.headHeight],
      ],
      36,
    )
    look.plate('plastic', DARK, socket, g.length + g.headHeight + 0.01)
    return
  }
  if (g.kind === 'insert') {
    const r = g.outerDiameter / 2
    const body = knurled(r, r, r, 0.18, 20)
    body.holes.push(
      circle(
        new THREE.Path(),
        r,
        r,
        Math.max(0.6, (Number(g.thread.replace(/[^0-9.]/g, '')) || 3) / 2),
      ),
    )
    look.extrude('brass', part.look?.colour, body, 0, g.length, 12)
    return
  }
  if (g.kind === 'standoff') {
    const r = g.acrossFlats / 2
    const hex = regular(new THREE.Shape(), r, r, g.acrossFlats / Math.sqrt(3), 6)
    hex.holes.push(
      circle(
        new THREE.Path(),
        r,
        r,
        Math.max(0.6, (Number(g.thread.replace(/[^0-9.]/g, '')) || 2.5) / 2),
      ),
    )
    look.extrude(part.look?.finish ?? 'brass', part.look?.colour, hex, 0, g.length, 12)
  }
}

function motorLook(look: Look, part: CataloguePart, g: Geometry<'motor'>) {
  const f = g.frame
  const cap = Math.min(8, g.bodyLength * 0.2)
  const square = () => roundedRect(new THREE.Shape(), 0, 0, f, f, 4)
  look.extrude('anodised', '#c3c8cd', square(), 0, cap)
  const middle = roundedRect(new THREE.Shape(), 0.35, 0.35, f - 0.7, f - 0.7, 3.8)
  look.extrude('anodised', part.look?.colour ?? '#26292d', middle, cap, g.bodyLength - 2 * cap)
  look.extrude('anodised', '#c3c8cd', square(), g.bodyLength - cap, cap)
  look.cylinder('anodised', '#c3c8cd', f / 2, f / 2, g.bodyLength, g.bossDiameter, g.bossHeight, 40)
  look.cylinder(
    'metal',
    undefined,
    f / 2,
    f / 2,
    g.bodyLength + g.bossHeight,
    g.shaftDiameter,
    g.shaftLength,
    24,
  )
  for (const hole of part.mountingHoles ?? [])
    look.plate(
      'plastic',
      DARK,
      circle(new THREE.Shape(), hole.x, hole.y, hole.diameter / 2),
      g.bodyLength + 0.01,
    )
}

function bearingLook(look: Look, part: CataloguePart, g: Geometry<'bearing'>) {
  const r = g.outerDiameter / 2
  const ring = (outer: number, inner: number) => {
    const shape = circle(new THREE.Shape(), r, r, outer)
    shape.holes.push(circle(new THREE.Path(), r, r, inner))
    return shape
  }
  const inner = g.innerDiameter / 2
  const wall = Math.max(0.6, (r - inner) * 0.22)
  if (part.look?.style === 'linear') {
    look.extrude('metal', undefined, ring(r, inner + wall), 1, g.width - 2, 48)
    look.extrude('rubber', undefined, ring(r - 0.3, inner), 0, 1, 48)
    look.extrude('rubber', undefined, ring(r - 0.3, inner), g.width - 1, 1, 48)
    for (const z of [g.width * 0.14, g.width * 0.86 - 0.8])
      look.extrude('plastic', '#6b7178', ring(r + 0.02, r - 0.4), z, 0.8, 48)
    return
  }
  look.extrude('metal', undefined, ring(r, r - wall), 0, g.width, 48)
  look.extrude('metal', undefined, ring(inner + wall, inner), 0, g.width, 48)
  look.extrude('metal', '#9aa1a8', ring(r - wall, inner + wall), 0.25, g.width - 0.5, 48)
}

function extrusionLook(look: Look, part: CataloguePart, g: Geometry<'extrusion'>) {
  const s = g.size
  const slot = (u: [number, number], n: [number, number], m: [number, number]) =>
    [
      [-3, 0],
      [-3, 6],
      [-5.5, 6],
      [-5.5, 11],
      [5.5, 11],
      [5.5, 6],
      [3, 6],
      [3, 0],
    ].map(([a, b]) => [m[0] + u[0] * a + n[0] * b, m[1] + u[1] * a + n[1] * b] as [number, number])
  const sides: Array<[[number, number], [number, number], [number, number], [number, number]]> = [
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [s / 2, 0],
    ],
    [
      [s, 0],
      [0, 1],
      [-1, 0],
      [s, s / 2],
    ],
    [
      [s, s],
      [-1, 0],
      [0, -1],
      [s / 2, s],
    ],
    [
      [0, s],
      [0, -1],
      [1, 0],
      [0, s / 2],
    ],
  ]
  const slots = g.slots ?? 4
  const points: Array<[number, number]> = []
  sides.forEach(([corner, u, n, m], i) => {
    points.push(corner)
    if (i < slots) points.push(...slot(u, n, m))
  })
  const profile = polygon(new THREE.Shape(), points)
  profile.holes.push(circle(new THREE.Path(), s / 2, s / 2, 2.1))
  const geometry = new THREE.ExtrudeGeometry(profile, {
    depth: g.length,
    bevelEnabled: false,
    curveSegments: 16,
  })
  geometry.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1))
  look.add('anodised', part.look?.colour ?? '#c3c8cd', geometry)
}

function hashText(text: string): string {
  let hash = 5381
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  return (hash >>> 0).toString(36)
}

const prototypes = new Map<string, LookPrototype>()

export function lookKey(part: CataloguePart): string {
  return `${part.id}:${hashText(JSON.stringify(part))}`
}

export function lookPrototype(part: CataloguePart): LookPrototype {
  const key = lookKey(part)
  const cached = prototypes.get(key)
  if (cached) return cached
  const look = new Look()
  const g = part.geometry
  switch (g.kind) {
    case 'board':
      boardLook(look, part, g)
      break
    case 'connector':
      connectorLook(look, part, g)
      break
    case 'screw':
    case 'insert':
    case 'standoff':
      fastenerLook(look, part)
      break
    case 'motor':
      motorLook(look, part, g)
      break
    case 'bearing':
      bearingLook(look, part, g)
      break
    case 'extrusion':
      extrusionLook(look, part, g)
      break
  }
  const prototype = look.build(key)
  if (prototypes.size > 240) {
    const oldest = prototypes.keys().next().value
    if (oldest) prototypes.delete(oldest)
  }
  prototypes.set(key, prototype)
  return prototype
}

export interface LookInstance {
  key: string
  group: THREE.Group
  materials: THREE.MeshStandardMaterial[]
  lines: THREE.LineBasicMaterial
}

export function createLook(
  prototype: LookPrototype,
  options: { clippingPlanes?: THREE.Plane[]; envMap?: THREE.Texture | null; edgeColour?: number },
): LookInstance {
  const group = new THREE.Group()
  const lines = new THREE.LineBasicMaterial({
    color: options.edgeColour ?? 0x1d2126,
    transparent: true,
    opacity: 0.3,
    clippingPlanes: options.clippingPlanes ?? [],
  })
  const materials = prototype.meshes.map((entry) => {
    const finish = FINISHES[entry.finish]
    const material = new THREE.MeshStandardMaterial({
      color: entry.colour,
      roughness: finish.roughness,
      metalness: finish.metalness,
      envMap: options.envMap ?? null,
      envMapIntensity: finish.env,
      transparent: finish.opacity !== undefined,
      opacity: finish.opacity ?? 1,
      clippingPlanes: options.clippingPlanes ?? [],
      side: THREE.DoubleSide,
    })
    material.userData.baseOpacity = finish.opacity ?? 1
    const mesh = new THREE.Mesh(entry.geometry, material)
    group.add(mesh)
    if (entry.edges) group.add(new THREE.LineSegments(entry.edges, lines))
    return material
  })
  return { key: prototype.key, group, materials, lines }
}

export function disposeLook(look: LookInstance) {
  for (const material of look.materials) material.dispose()
  look.lines.dispose()
}
