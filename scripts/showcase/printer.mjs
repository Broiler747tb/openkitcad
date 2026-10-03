// An original Cartesian printer assembly for the OpenKitCAD showcase.
// Dimensions are millimetres. Z is up; the operator stands at negative Y.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { deflateSync } from 'fflate'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import {
  setOC,
  makeBox,
  makeCylinder,
  makeCompound,
  draw,
  drawRectangle,
  drawRoundedRectangle,
  drawCircle,
  drawPolysides,
  sketchCircle,
  exportSTEP,
  measureVolume,
  Plane,
} from 'replicad'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const out = resolve(process.env.SHOWCASE_OUTPUT || resolve(root, 'release/showcase'))
mkdirSync(out, { recursive: true })
const require = createRequire(import.meta.url)
const initPath = require.resolve('replicad-opencascadejs/src/replicad_single.js')
const runtime = resolve(out, 'oc-runtime.cjs')
writeFileSync(
  runtime,
  readFileSync(initPath, 'utf8').replace('export default Module;', 'module.exports = Module;'),
)
setOC(
  await require(runtime)({
    wasmBinary: readFileSync(initPath.replace(/\.js$/, '.wasm')),
    print: () => {},
    printErr: console.error,
  }),
)

const colours = {
  frame: '#28343f',
  silver: '#bac5ce',
  rail: '#8d9ca9',
  steel: '#d5dde3',
  plastic: '#1590ac',
  dark: '#243039',
  rubber: '#131a21',
  copper: '#b36c40',
  brass: '#cda65a',
  pei: '#b4a37e',
  wire: '#303b48',
  red: '#cb5147',
  filament: '#e27b4a',
  screen: '#173d4a',
  white: '#cbd5df',
  pcb: '#237959',
}
const specs = []
const definitions = new Map()
const connections = []
const checks = []
let serial = 0
const v = (a) => new THREE.Vector3(...a)
const add = (a, b) => a.map((x, i) => x + b[i])
const mul = (a, s) => a.map((x) => x * s)
const identity = new THREE.Quaternion()
const axisQ = (axis, from = [0, 0, 1]) =>
  new THREE.Quaternion().setFromUnitVectors(v(from), v(axis).normalize())
const frameQ = (x, y, z) =>
  new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(v(x), v(y), v(z)))
function transformed(s, p, q = identity) {
  let result = s.clone()
  const angle = 2 * Math.acos(Math.max(-1, Math.min(1, q.w)))
  const sin = Math.sin(angle / 2)
  if (angle > 1e-8 && Math.abs(sin) > 1e-8)
    result = result.rotate((angle * 180) / Math.PI, [0, 0, 0], [q.x / sin, q.y / sin, q.z / sin])
  return result.translate(p)
}
function shape(key, build) {
  if (!definitions.has(key)) definitions.set(key, { key, shape: build() })
  return definitions.get(key)
}
function place(key, name, build, p = [0, 0, 0], q = identity, material = 'frame', group = 'Frame') {
  const definition = shape(key, build)
  const item = {
    id: 'part-' + ++serial,
    name,
    definition,
    p,
    q: q.clone(),
    material,
    group,
    holes: [],
  }
  specs.push(item)
  return item
}
function roundBox(w, d, h, r = 0.8) {
  return drawRoundedRectangle(w, d, r).sketchOnPlane('XY').extrude(h)
}
function box(key, name, p, w, d, h, material, group, r = 0.8, q = identity) {
  return place(key, name, () => roundBox(w, d, h, r), p, q, material, group)
}
function cylinder(key, name, p, r, h, axis, material, group, inner = 0) {
  return place(
    key,
    name,
    () =>
      inner ? makeCylinder(r, h).cut(makeCylinder(inner, h + 2, [0, 0, -1])) : makeCylinder(r, h),
    p,
    axisQ(axis),
    material,
    group,
  )
}
function bore(item, point, axis, d, length, counter = 0, counterDepth = 0) {
  item.holes.push({ point, axis, d, length, counter, counterDepth })
}
// A bolt's origin is the underside of its head. Its axis points into the joint.
// Clearances are cut using these same coordinates, rather than an independent hole list.
function bolt(
  name,
  seat,
  axis,
  d,
  length,
  targets,
  group = 'Fasteners',
  counter = 0,
  flat = false,
) {
  if (!targets.length) throw Error('Unattached bolt: ' + name)
  const headD = d === 5 ? 8.5 : d === 4 ? 7 : 5.5
  const headH = flat ? 1.5 : d
  const key = `${flat ? 'countersunk' : 'socket'}-M${d}x${length}`
  const b = place(
    key,
    name,
    () => {
      const shank = makeCylinder(d / 2, length)
      const head = flat
        ? sketchCircle(3.1, { origin: [0, 0, -headH] }).loftWith(sketchCircle(d / 2))
        : makeCylinder(headD / 2, headH, [0, 0, -headH])
      const socket = drawPolysides((d * 0.5) / Math.cos(Math.PI / 6), 6)
        .sketchOnPlane('XY', -headH - 0.1)
        .extrude(headH * 0.64)
      return shank.fuse(head).cut(socket)
    },
    seat,
    axisQ(axis),
    'steel',
    group,
  )
  for (const target of targets)
    bore(
      target,
      add(seat, mul(axis, -0.1)),
      axis,
      d + 0.35,
      length + 0.2,
      counter,
      counter ? headH + 0.15 : 0,
    )
  connections.push({
    name,
    seat,
    axis,
    diameter: d,
    length,
    boltId: b.id,
    targets: targets.map((t) => t.id),
  })
  return b
}
function extrusion(name, start, end, group = 'Frame') {
  const len = v(end).distanceTo(v(start))
  const direction = v(end).sub(v(start)).normalize()
  const cross =
    Math.abs(direction.x) < 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const q = frameQ(direction.toArray(), cross.toArray(), direction.clone().cross(cross).toArray())
  return place(
    '2020-' + len,
    name,
    () => {
      let profile = drawRectangle(20, 20)
      for (let i = 0; i < 4; i++) {
        const cutter = drawRectangle(6, 4)
          .translate(0, 8)
          .fuse(drawRectangle(10, 4).translate(0, 4))
          .rotate(i * 90)
        profile = profile.cut(cutter)
      }
      return profile.cut(drawCircle(2.1)).sketchOnPlane('YZ').extrude(len)
    },
    start,
    q,
    'frame',
    group,
  )
}
function tnut(name, seat, axis, group = 'Frame') {
  // The underside of a 4 mm bracket is against the extrusion face.
  // The nut sits 7 mm behind that face, within the broad part of the T slot.
  const q = axisQ(axis)
  return box('M5-T-nut', name, add(seat, mul(axis, 9.5)), 10, 8, 2.5, 'silver', group, 0.4, q)
}
function slotBolt(name, seat, axis, bracket, group = 'Frame') {
  const nut = tnut(name + ' T-nut', seat, axis, group)
  return bolt(name, seat, axis, 5, 12, [bracket, nut], group)
}
function stepper(
  name,
  face,
  axis,
  group,
  mount = null,
  { frame = 42.3, bodyLength = 40, spacing = 31 } = {},
) {
  const q = axisQ(axis)
  const point = (p) => add(face, v(p).applyQuaternion(q).toArray())
  box(
    'stepper-body-' + frame + '-' + bodyLength,
    name + ' laminated body',
    point([0, 0, -bodyLength + 3]),
    frame,
    frame,
    bodyLength - 6,
    'dark',
    group,
    2,
    q,
  )
  const front = box(
    'stepper-front-' + frame,
    name + ' aluminium front',
    point([0, 0, -3]),
    frame,
    frame,
    3,
    'silver',
    group,
    2,
    q,
  )
  box(
    'stepper-back-' + frame,
    name + ' rear cap',
    point([0, 0, -bodyLength]),
    frame,
    frame,
    3,
    'silver',
    group,
    2,
    q,
  )
  cylinder('NEMA17-boss', name + ' centring boss', face, 11, 2, axis, 'silver', group)
  cylinder('NEMA17-shaft', name + ' 5 mm shaft', face, 2.5, 24, axis, 'steel', group)
  if (mount)
    for (const x of [-spacing / 2, spacing / 2])
      for (const y of [-spacing / 2, spacing / 2]) {
        const seat = point([x, y, 6])
        bolt(name + ' M3 mount', seat, mul(axis, -1), 3, 10, [mount, front], group)
      }
  return { face, axis, q, point, front }
}
function pulley(name, centre, axis, r, group, boreR = 2.5) {
  const q = axisQ(axis)
  const p = (z) => add(centre, mul(axis, z))
  cylinder('GT2-' + r + '-body', name + ' tooth drum', p(-3.5), r, 7, axis, 'silver', group, boreR)
  cylinder(
    'GT2-' + r + '-flange',
    name + ' inner flange',
    p(-4.5),
    r + 1,
    1,
    axis,
    'silver',
    group,
    boreR,
  )
  cylinder(
    'GT2-' + r + '-flange',
    name + ' outer flange',
    p(3.5),
    r + 1,
    1,
    axis,
    'silver',
    group,
    boreR,
  )
  // Twenty 2 mm-pitch teeth, radial ribs recessed between the belt runs.
  for (let i = 0; i < 20; i++) {
    const a = (i * Math.PI) / 10
    const local = [(r - 0.15) * Math.cos(a), (r - 0.15) * Math.sin(a), -3.5]
    cylinder(
      'GT2-tooth',
      name + ' tooth ' + (i + 1),
      add(centre, v(local).applyQuaternion(q).toArray()),
      0.38,
      7,
      axis,
      'silver',
      group,
    )
  }
}
function meshPart(
  key,
  name,
  geometry,
  p = [0, 0, 0],
  q = identity,
  material = 'rubber',
  group = 'Wiring',
) {
  if (!definitions.has(key)) definitions.set(key, { key, geometry })
  const item = {
    id: 'part-' + ++serial,
    name,
    definition: definitions.get(key),
    p,
    q: q.clone(),
    material,
    group,
    holes: [],
  }
  specs.push(item)
  return item
}
function cable(name, points, r, material = 'wire', group = 'Wiring') {
  const path = new THREE.CatmullRomCurve3(points.map(v))
  return meshPart(
    'curve-' + name,
    name,
    new THREE.TubeGeometry(path, Math.max(48, points.length * 24), r, 12, false),
    [0, 0, 0],
    identity,
    material,
    group,
  )
}
function belt(name, a, b, r, width, q, p, group) {
  // Local loop: two pulley centres on X. Local Y is radial, Z is belt width.
  const outer = new THREE.Shape()
  outer.moveTo(a, r + 0.8)
  outer.lineTo(b, r + 0.8)
  outer.absarc(b, 0, r + 0.8, Math.PI / 2, -Math.PI / 2, true)
  outer.lineTo(a, -r - 0.8)
  outer.absarc(a, 0, r + 0.8, -Math.PI / 2, Math.PI / 2, true)
  const hole = new THREE.Path()
  hole.moveTo(a, r - 0.8)
  hole.absarc(a, 0, r - 0.8, Math.PI / 2, Math.PI * 1.5, false)
  hole.lineTo(b, -r + 0.8)
  hole.absarc(b, 0, r - 0.8, -Math.PI / 2, Math.PI / 2, false)
  hole.closePath()
  outer.holes.push(hole)
  const geom = new THREE.ExtrudeGeometry(outer, {
    depth: width,
    bevelEnabled: false,
    curveSegments: 36,
  }).translate(0, 0, -width / 2)
  meshPart(name, name, geom, p, q, 'rubber', group)
  // Teeth along the straight belt spans, matching GT2 2 mm pitch.
  const teeth = []
  for (let x = a + 1; x < b; x += 2)
    for (const y of [-r + 0.65, r - 0.65]) {
      teeth.push(new THREE.BoxGeometry(0.75, 0.65, width).translate(x, y, 0))
    }
  meshPart(name + '-teeth', name + ' GT2 teeth', mergeGeometries(teeth), p, q, 'rubber', group)
}
function rail(name, start, length, q, group, riser = null) {
  const item = place(
    'MGN12-' + length,
    name,
    () => {
      let s = makeBox([0, -6, 0], [length, 6, 8])
      s = s
        .cut(makeBox([-1, -6.2, 3], [length + 1, -4.8, 5]))
        .cut(makeBox([-1, 4.8, 3], [length + 1, 6.2, 5]))
      for (let x = 15; x < length; x += 25) {
        s = s.cut(makeCylinder(1.75, 10, [x, 0, -1])).cut(makeCylinder(3, 3.5, [x, 0, 4.5]))
      }
      return s
    },
    start,
    q,
    'rail',
    group,
  )
  // Flush screws engage the extrusion's slot nuts, clear of the moving truck.
  for (let x = 15; x < length; x += 50) {
    const point = (p) => add(start, v(p).applyQuaternion(q).toArray())
    const axis = v([0, 0, -1]).applyQuaternion(q).toArray()
    const nut = box(
      'M3-rail-slot-nut',
      name + ' slot nut',
      point([x, 0, riser ? -13.5 : -7.5]),
      8,
      8,
      2.5,
      'silver',
      group,
      0.3,
      q,
    )
    bolt(
      name + ' recessed mounting screw',
      point([x, 0, 4.5]),
      axis,
      3,
      riser ? 18 : 12,
      riser ? [riser, nut] : [nut],
      group,
    )
  }
  return item
}
function truck(name, start, q, group) {
  const body = place(
    'MGN12H-truck',
    name,
    () => {
      let s = roundBox(33.4, 27, 13, 1)
      s = s.cut(makeBox([-24, -6.1, -1], [24, 6.1, 8.05]))
      return s
    },
    start,
    q,
    'silver',
    group,
  )
  for (const x of [-19.7, 19.7])
    place(
      'MGN12H-end',
      name + ' polymer end cap',
      () => roundBox(6, 27, 11, 0.7).cut(makeBox([-4, -6.1, -1], [4, 6.1, 7.05])),
      add(start, v([x, 0, 1]).applyQuaternion(q).toArray()),
      q,
      'dark',
      group,
    )
  return body
}

console.log('Building frame and bed…')
for (const x of [-200, 200]) extrusion('Base side extrusion', [x, -230, 30], [x, 230, 30])
for (const y of [-220, 220]) extrusion('Base cross extrusion', [-190, y, 30], [190, y, 30])
for (const x of [-65, 65]) extrusion('Y rail support', [x, -210, 30], [x, 210, 30], 'Y motion')
for (const x of [-200, 200]) extrusion('Portal upright', [x, 20, 40], [x, 20, 470])
const topBeam = extrusion('Portal top beam', [-190, 20, 470], [190, 20, 470])
// Side plates bridge each portal/base joint, with two bolts into each T slot.
for (const x of [-214, 214]) {
  const outward = x < 0 ? -1 : 1,
    axis = [-outward, 0, 0],
    q = axisQ(axis)
  for (const z of [60, 447]) {
    const plate = box(
      'portal-joint-plate-' + z,
      'Portal joint plate',
      [x, 20, z],
      z === 60 ? 76 : 64,
      40,
      4,
      'silver',
      'Frame',
      3,
      q,
    )
    for (const height of z === 60 ? [30, 55, 78] : [427, 447])
      slotBolt('Portal joint M5', [x, 20, height], axis, plate)
    if (z === 447) {
      const post = specs.find((p) => p.name === 'Portal upright' && Math.sign(p.p[0]) === outward)
      bolt('Portal top beam axial M5', [x, 20, 470], axis, 5, 40, [plate, post, topBeam], 'Frame')
    }
  }
}
for (const x of [-200, 200])
  for (const y of [-190, 190]) {
    const foot = cylinder(
      'foot',
      'Rubber isolation foot',
      [x, y, 0],
      13,
      20,
      [0, 0, 1],
      'rubber',
      'Frame',
    )
    foot.holes.push({ custom: makeCylinder(4.5, 5.1, [x, y, -0.1]) })
    const nut = box(
      'foot-nut',
      'Foot mounting T-nut',
      [x, y, 25.5],
      10,
      8,
      2.5,
      'silver',
      'Frame',
      0.3,
    )
    bolt('Foot retaining M5', [x, y, 5], [0, 0, 1], 5, 25, [foot, nut], 'Frame')
  }
// Four base corner angle brackets; one vertical and one horizontal slotted flange.
for (const x of [-184, 184])
  for (const y of [-204, 204]) {
    const sx = Math.sign(x),
      sy = Math.sign(y)
    const bracket = box(
      'base-corner',
      'Base corner gusset',
      [x, y, 40],
      52,
      52,
      4,
      'silver',
      'Frame',
      2,
    )
    slotBolt('Base corner side M5', [sx * 200, y, 44], [0, 0, -1], bracket)
    slotBolt('Base corner cross M5', [x, sy * 220, 44], [0, 0, -1], bracket)
  }
const qY = frameQ([0, 1, 0], [-1, 0, 0], [0, 0, 1])
for (const x of [-65, 65]) {
  // 6 mm risers keep rail trucks above the front/rear cross members.
  const riser = box('Y-rail-riser', 'Y rail riser', [x, 0, 40], 16, 376, 6, 'silver', 'Y motion', 1)
  rail('Y linear rail', [x, -190, 46], 380, qY, 'Y motion', riser)
  for (const side of [-1, 1]) {
    const plate = box(
      'Y-profile-link',
      'Y support to frame plate',
      [x, side * 218, 40],
      28,
      40,
      4,
      'silver',
      'Y motion',
      2,
    )
    for (const y of [side * 202, side * 220])
      slotBolt('Y support frame M5', [x, y, 44], [0, 0, -1], plate, 'Y motion')
  }
}
const bedY = -30
const bedTrucks = []
for (const x of [-65, 65])
  for (const y of [bedY - 55, bedY + 55])
    bedTrucks.push(truck('Y bearing carriage', [x, y, 46], qY, 'Y motion'))
const carriage = box(
  'Y-carriage-plate',
  'Bed carrier plate',
  [0, bedY, 59],
  210,
  210,
  4,
  'silver',
  'Y motion',
  6,
)
bedTrucks.forEach((t) => {
  for (const dx of [-10, 10])
    for (const dy of [-10, 10])
      bolt(
        'Bed carriage M3',
        [t.p[0] + dx, t.p[1] + dy, 63],
        [0, 0, -1],
        3,
        8,
        [carriage, t],
        'Y motion',
      )
})
const heater = box(
  'heated-bed',
  'Aluminium heated bed',
  [0, bedY, 80],
  220,
  220,
  3,
  'silver',
  'Build plate',
  3,
)
box(
  'bed-insulation',
  'Heatbed underside insulation',
  [0, bedY, 76],
  212,
  212,
  3,
  'dark',
  'Build plate',
  2,
)
const sheet = box(
  'PEI-sheet',
  'Flexible PEI build surface',
  [0, bedY, 83.5],
  220,
  220,
  0.7,
  'pei',
  'Build plate',
  3,
)
for (const x of [-95, 95])
  for (const y of [bedY - 95, bedY + 95]) {
    // Bed screws thread through the adjuster knobs; spacers/springs support the bed.
    const knob = cylinder(
      'bed-knob',
      'Bed levelling wheel',
      [x, y, 52],
      10,
      7,
      [0, 0, 1],
      'dark',
      'Build plate',
    )
    const spacer = cylinder(
      'bed-spacer',
      'Silicone bed spacer',
      [x, y, 63],
      4.5,
      17,
      [0, 0, 1],
      'rubber',
      'Build plate',
      1.75,
    )
    heater.holes.push({
      custom: sketchCircle(1.5, { origin: [x, y, 81.5] }).loftWith(
        sketchCircle(3.1, { origin: [x, y, 83.1] }),
      ),
    })
    bolt(
      'Bed levelling M3',
      [x, y, 81.5],
      [0, 0, -1],
      3,
      30,
      [heater, carriage, knob],
      'Build plate',
      0,
      true,
    )
  }
// Y drive. Axis is X: the belt runs in the Y/Z plane between two pulleys.
const yMotorMount = box(
  'Y-motor-mount',
  'Y motor mount',
  [15, 255, 52],
  55,
  58,
  6,
  'plastic',
  'Y drive',
  4,
  axisQ([-1, 0, 0]),
)
bore(yMotorMount, [16, 255, 52], [-1, 0, 0], 22.4, 8)
yMotorMount.holes.push({ custom: makeBox([8, 215, 20], [16, 232, 40]) })
const yMotorFoot = box(
  'Y-motor-foot',
  'Y motor bracket foot',
  [-11, 239, 40],
  40,
  58,
  4,
  'plastic',
  'Y drive',
  2,
)
for (const x of [-25, -13])
  slotBolt('Y motor frame bolt', [x, 220, 44], [0, 0, -1], yMotorFoot, 'Y drive')
const yMotor = stepper('Y motor', [15, 255, 52], [-1, 0, 0], 'Y drive', yMotorMount)
pulley('Y motor GT2 pulley', [0, 255, 52], [1, 0, 0], 6.366, 'Y drive')
const yIdlerMount = place(
  'Y-idler-mount',
  'Y idler fork',
  () =>
    roundBox(28, 20, 27, 3)
      .translate([0, -239, 40])
      .fuse(makeBox([-14, -249, 40], [14, -210, 44])),
  [0, 0, 0],
  identity,
  'plastic',
  'Y drive',
)
const yIdlerBore = makeBox([-5, -250, 44], [5, -228, 68])
// Fork clearance is cut before the bearing/pulley is installed.
yIdlerMount.holes.push({ custom: yIdlerBore })
pulley('Y return idler', [0, -239, 52], [1, 0, 0], 6.366, 'Y drive')
bolt('Y idler axle', [14, -239, 52], [-1, 0, 0], 5, 28, [yIdlerMount], 'Y drive')
for (const x of [-10, 10])
  slotBolt('Y idler frame bolt', [x, -220, 44], [0, 0, -1], yIdlerMount, 'Y drive')
belt(
  'Y continuous GT2 belt',
  -239,
  255,
  6.366,
  6,
  frameQ([0, 1, 0], [0, 0, 1], [1, 0, 0]),
  [0, 0, 52],
  'Y drive',
)
const yClamp = box(
  'Y-belt-clamp',
  'Bed belt anchor',
  [0, bedY, 58],
  18,
  24,
  5,
  'plastic',
  'Y drive',
  2,
)
for (const y of [bedY - 8, bedY + 8])
  bolt('Bed belt anchor M3', [0, y, 63], [0, 0, -1], 3, 8, [carriage, yClamp], 'Y drive')

console.log('Building dual Z and X gantry…')
const zTrucks = []
const qZ = frameQ([0, 0, 1], [1, 0, 0], [0, 1, 0])
// Rail normals point towards the operator (-Y).
const qZfront = frameQ([0, 0, 1], [-1, 0, 0], [0, -1, 0])
for (const x of [-200, 200]) {
  rail('Z linear rail', [x, 10, 82], 360, qZfront, 'Z motion')
  zTrucks.push(truck('Z bearing carriage', [x, 10, 240], qZfront, 'Z motion'))
}
const gantry = extrusion('X gantry beam', [-152, -17, 240], [152, -17, 240], 'X motion')
for (const side of [-1, 1]) {
  const x = side * 164
  const upright = box(
    'Z-motor-backplate',
    'Z motor bracket backplate',
    [side * 184, 8, 42],
    80,
    4,
    40,
    'plastic',
    'Z drive',
    2,
  )
  const mount = box(
    'Z-motor-mount',
    'Z motor horizontal mount',
    [side * 164, -22, 62],
    64,
    56,
    4,
    'plastic',
    'Z drive',
    3,
  )
  bore(mount, [x, -17, 61], [0, 0, 1], 22.4, 6)
  for (const z of [52, 72])
    slotBolt('Z motor bracket M5', [side * 200, 6, z], [0, 1, 0], upright, 'Z drive')
  stepper(side < 0 ? 'Left Z motor' : 'Right Z motor', [x, -17, 62], [0, 0, 1], 'Z drive', mount)
  const coupling = cylinder(
    'Z-coupling',
    'Flexible shaft coupler',
    [x, -17, 76],
    9.5,
    25,
    [0, 0, 1],
    'silver',
    'Z drive',
    2.5,
  )
  bore(coupling, [x, -17, 88], [0, 0, 1], 8.1, 14)
  for (let i = 0; i < 3; i++)
    coupling.holes.push({
      custom: makeBox(
        [x - 10, i % 2 ? -16 : -28, 85 + i * 3],
        [x + 10, i % 2 ? -6 : -18, 85.7 + i * 3],
      ),
    })
  for (const [z, L] of [
    [81, 7],
    [96, 5.5],
  ]) {
    const axis = [-side, 0, 0],
      point = [x + side * 9.5, -17, z]
    bore(coupling, point, axis, 2.8, L)
    place(
      'grub-M3-' + L,
      'Coupler locking grub screw',
      () =>
        makeCylinder(1.5, L).cut(
          drawPolysides(0.8 / Math.cos(Math.PI / 6), 6)
            .sketchOnPlane('XY', -0.1)
            .extrude(1.6),
        ),
      point,
      axisQ(axis),
      'dark',
      'Z drive',
    )
  }
  cylinder('T8-core', 'T8 lead screw core', [x, -17, 88], 3.35, 363, [0, 0, 1], 'steel', 'Z drive')
  // Four-start T8x8 helix, 2 mm pitch. Cosmetic thread is an actual helical mesh.
  const pts = [],
    indices = []
  const turns = 363 / 8,
    segments = Math.ceil(turns * 64)
  for (let start = 0; start < 4; start++) {
    const base = pts.length / 3
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * turns * 2 * Math.PI + (start * Math.PI) / 2,
        z = (i / segments) * 363
      for (const [r, dz] of [
        [3.32, -0.62],
        [4, 0],
        [3.32, 0.62],
      ])
        pts.push(r * Math.cos(a), r * Math.sin(a), z + dz)
    }
    for (let i = 0; i < segments; i++)
      for (let j = 0; j < 3; j++) {
        const a = base + i * 3 + j,
          b = base + i * 3 + ((j + 1) % 3),
          c = b + 3,
          d = a + 3
        indices.push(a, b, c, a, c, d)
      }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  g.setIndex(indices)
  g.computeVertexNormals()
  meshPart(
    'T8x8-thread',
    'T8 four-start helical thread',
    g,
    [x, -17, 88],
    identity,
    'steel',
    'Z drive',
  )
  const end = box(
    'X-end-' + side,
    'X gantry end saddle',
    [side * 187.5, -18.5, 222],
    71,
    21,
    33,
    'plastic',
    'X motion',
    3,
  )
  bore(end, [x, -17, 217], [0, 0, 1], 11, 40)
  const nut = cylinder(
    'T8-nut-flange',
    'Brass T8 flange nut',
    [x, -17, 218],
    11,
    4,
    [0, 0, 1],
    'brass',
    'Z drive',
    4.15,
  )
  cylinder(
    'T8-nut-neck',
    'T8 nut sleeve',
    [x, -17, 222],
    5,
    15,
    [0, 0, 1],
    'brass',
    'Z drive',
    4.15,
  )
  for (const [dx, dy] of [
    [8, 0],
    [-8, 0],
    [0, 8],
    [0, -8],
  ])
    bolt('T8 nut flange M3', [x + dx, -17 + dy, 218], [0, 0, 1], 3, 12, [nut, end], 'Z drive')
  const zPlate = box(
    'Z-gantry-link',
    'Z truck to gantry plate',
    [side * 200, -5.5, 218],
    50,
    5,
    48,
    'silver',
    'Z motion',
    2,
  )
  const truckItem = zTrucks[side < 0 ? 0 : 1]
  for (const dx of [-10, 10])
    for (const dz of [-10, 10])
      bolt(
        'Z truck M3',
        [side * 200 + dx, -8, 240 + dz],
        [0, 1, 0],
        3,
        10,
        [zPlate, truckItem],
        'Z motion',
      )
  for (const dx of [-10, 10])
    for (const dz of [-10, 10]) bore(end, [side * 200 + dx, -30, 240 + dz], [0, 1, 0], 6, 22.1)
  // Saddle is fastened at its rear face into the Z plate.
  for (const dx of [-16, 16])
    bolt(
      'X saddle link M4',
      [side * 200 + dx, -29, 231],
      [0, 1, 0],
      4,
      25,
      [end, zPlate],
      'X motion',
    )
  // A stepped saddle cap clamps the beam's top slot without crossing the Z screw.
  const cap = place(
    'beam-cap-' + side,
    'Stepped X beam retaining plate',
    () => {
      const mirror = (s) => (side < 0 ? s.mirror('YZ') : s)
      return mirror(
        makeBox([126, -27, 250], [150, -8, 255])
          .fuse(makeBox([146, -27, 250], [154, -8, 259]))
          .fuse(makeBox([146, -27, 255], [205, -8, 259])),
      )
    },
    [0, 0, 0],
    identity,
    'silver',
    'X motion',
  )
  bore(cap, [x, -17, 249], [0, 0, 1], 11, 12)
  slotBolt('X beam retaining M5', [side * 138, -17, 255], [0, 0, -1], cap, 'X motion')
  for (const xx of [side * 182, side * 196])
    bolt('X saddle retaining M4', [xx, -17, 259], [0, 0, -1], 4, 12, [cap, end], 'X motion')
}
const qXfront = frameQ([1, 0, 0], [0, 0, 1], [0, -1, 0])
rail('X linear rail', [-150, -27, 240], 300, qXfront, 'X motion')
const headX = 28
const xTruck = truck('X bearing carriage', [headX, -27, 240], qXfront, 'X motion')
const toolPlate = box(
  'tool-plate',
  'Toolhead mounting plate',
  [headX, -43, 194],
  52,
  6,
  76,
  'silver',
  'Toolhead',
  3,
)
for (const dx of [-10, 10])
  for (const dz of [-10, 10])
    bolt(
      'Tool plate M3',
      [headX + dx, -46, 240 + dz],
      [0, 1, 0],
      3,
      12,
      [toolPlate, xTruck],
      'Toolhead',
    )
const xMotorMount = box(
  'X-motor-plate',
  'X motor bracket',
  [-174, -32, 248],
  50,
  6,
  50,
  'plastic',
  'X drive',
  3,
)
bore(xMotorMount, [-174, -36, 273], [0, 1, 0], 22.4, 8)
stepper('X motor', [-174, -29, 273], [0, -1, 0], 'X drive', xMotorMount)
pulley('X motor GT2 pulley', [-174, -44, 273], [0, 1, 0], 6.366, 'X drive')
const xIdlerMount = box(
  'X-idler-plate',
  'X idler bracket',
  [174, -32, 248],
  46,
  6,
  48,
  'plastic',
  'X drive',
  3,
)
pulley('X return idler', [174, -44, 273], [0, 1, 0], 6.366, 'X drive')
const xIdlerNut = place(
  'M5-hex-nut',
  'X idler locknut',
  () => drawPolysides(4.6, 6).sketchOnPlane('XY').extrude(4),
  [174, -29, 273],
  axisQ([0, 1, 0]),
  'steel',
  'X drive',
)
cylinder(
  'idler-spacer',
  'X idler spacer',
  [174, -39.5, 273],
  4,
  4.5,
  [0, 1, 0],
  'silver',
  'X drive',
  2.6,
)
cylinder(
  'idler-washer',
  'X idler washer',
  [174, -49.5, 273],
  4.5,
  1,
  [0, 1, 0],
  'silver',
  'X drive',
  2.6,
)
bolt('X idler axle', [174, -49.5, 273], [0, 1, 0], 5, 26, [xIdlerMount, xIdlerNut], 'X drive')
for (const side of [-1, 1]) {
  const mount = side < 0 ? xMotorMount : xIdlerMount
  const end = specs.find((s) => s.name === 'X gantry end saddle' && Math.sign(s.p[0]) === side)
  for (const dx of [-12, 12])
    bolt(
      'X drive bracket M4',
      [side * 174 + dx, -35, 252],
      [0, 1, 0],
      4,
      12,
      [mount, end],
      'X drive',
    )
}
belt(
  'X continuous GT2 belt',
  -174,
  174,
  6.366,
  6,
  frameQ([1, 0, 0], [0, 0, 1], [0, -1, 0]),
  [0, -44, 273],
  'X drive',
)
toolPlate.holes.push({ custom: makeBox([headX - 12, -46.1, 264], [headX + 12, -39.9, 271]) })
const xClamp = place(
  'X-belt-anchor',
  'X belt clamp',
  () =>
    makeBox([headX - 11, -54, 256], [headX + 11, -46, 275])
      .fuse(makeBox([headX - 11, -46, 264], [headX + 11, -40, 270]))
      .cut(makeBox([headX - 12, -47, 265.8], [headX + 12, -41, 267.6])),
  [0, 0, 0],
  identity,
  'plastic',
  'X drive',
)
for (const dx of [-7, 7])
  bolt('X belt clamp M3', [headX + dx, -54, 260], [0, 1, 0], 3, 12, [xClamp, toolPlate], 'X drive')

console.log('Building hotend, cooling and extruder…')
const hotY = -61.125
const extruder = place(
  'extruder-housing',
  'Direct drive extruder housing',
  () =>
    roundBox(44, 42, 37, 4)
      .translate([headX, -67, 229])
      .fuse(makeBox([headX - 26, -52, 222], [headX + 26, -46, 229]))
      .fuse(makeBox([headX - 26, -52, 264], [headX + 26, -46, 270])),
  [0, 0, 0],
  identity,
  'plastic',
  'Toolhead',
)
extruder.holes.push({ custom: makeBox([headX - 14, -58, 256], [headX + 14, -45, 276]) })
// Bearing/drive aperture is on the motor face; the feed line is tangent to the hob.
bore(extruder, [6, -67, 248], [1, 0, 0], 22.4, 10)
bore(extruder, [headX, hotY, 220], [0, 0, 1], 2.15, 58)
const extruderMotor = stepper(
  'NEMA 14 extruder motor',
  [6, -67, 248],
  [1, 0, 0],
  'Toolhead',
  extruder,
  { frame: 35.2, bodyLength: 26, spacing: 26 },
)
for (const dy of [-13, 13])
  for (const dz of [-13, 13]) bore(extruder, [12, -67 + dy, 248 + dz], [1, 0, 0], 6, 40)
bore(extruder, [16, -67, 248], [1, 0, 0], 14, 27)
bore(extruder, [23, -55.25, 248], [1, 0, 0], 11, 21)
for (const dx of [-10, 10])
  for (const dz of [-10, 10]) bore(extruder, [headX + dx, -50, 240 + dz], [0, 1, 0], 6, 4.2)
for (const dx of [-17, 17])
  for (const z of [225.5, 267])
    bolt(
      'Extruder housing M3',
      [headX + dx, -52, z],
      [0, 1, 0],
      3,
      10,
      [extruder, toolPlate],
      'Toolhead',
    )
cylinder(
  'hobbed-drive',
  'Hobbed filament drive',
  [19, -67, 248],
  5,
  14,
  [1, 0, 0],
  'brass',
  'Toolhead',
  2.5,
)
cylinder(
  'idler-bearing',
  '623ZZ filament idler bearing',
  [26, -55.25, 248],
  5,
  4,
  [1, 0, 0],
  'steel',
  'Toolhead',
  1.5,
)
for (const [x, L] of [
  [23, 3],
  [30, 14],
])
  cylinder(
    'idler-sleeve-' + L,
    'Extruder idler spacer',
    [x, -55.25, 248],
    2.7,
    L,
    [1, 0, 0],
    'steel',
    'Toolhead',
    1.6,
  )
bolt('Extruder idler M3 axle', [50, -55.25, 248], [-1, 0, 0], 3, 35, [extruder], 'Toolhead')
const clamp = box(
  'hotend-clamp',
  'Hotend groove clamp',
  [headX, -61, 207],
  28,
  30,
  17,
  'plastic',
  'Toolhead',
  3,
)
bore(clamp, [headX, hotY, 205], [0, 0, 1], 10.1, 22)
bore(clamp, [headX, hotY, 205], [0, 0, 1], 12.2, 7)
bore(clamp, [headX, hotY, 221], [0, 0, 1], 12.2, 5)
for (const dx of [-10, 10])
  bolt('Hotend clamp M3', [headX + dx, -76, 221], [0, 1, 0], 3, 36, [clamp, toolPlate], 'Toolhead')
for (let i = 0; i < 10; i++)
  cylinder(
    'V6-fin',
    'V6 heatsink cooling fin',
    [headX, hotY, 180 + i * 2.5],
    11,
    1.4,
    [0, 0, 1],
    'silver',
    'Toolhead',
    3,
  )
cylinder(
  'V6-core',
  'V6 heatsink central tube',
  [headX, hotY, 179],
  6,
  28,
  [0, 0, 1],
  'silver',
  'Toolhead',
  1.1,
)
cylinder(
  'V6-neck',
  'V6 mount neck',
  [headX, hotY, 207],
  5,
  17,
  [0, 0, 1],
  'silver',
  'Toolhead',
  1.1,
)
for (const z of [207, 221])
  cylinder(
    'V6-mount-collar',
    'V6 groove mount collar',
    [headX, hotY, z],
    6,
    3,
    [0, 0, 1],
    'silver',
    'Toolhead',
    1.1,
  )
cylinder(
  'feed-guide',
  'PTFE feed guide',
  [headX, hotY, 224],
  2,
  7,
  [0, 0, 1],
  'white',
  'Toolhead',
  1.1,
)
cylinder(
  'V6-break',
  'Thin-wall heatbreak',
  [headX, hotY, 167],
  2.5,
  13,
  [0, 0, 1],
  'steel',
  'Toolhead',
  1.1,
)
const heaterBlock = box(
  'heater-block',
  'Heater block',
  [headX, hotY, 156.8],
  16,
  20,
  11,
  'silver',
  'Toolhead',
  0.8,
)
bore(heaterBlock, [headX - 9, hotY - 3, 162.5], [1, 0, 0], 6.1, 18)
cylinder(
  'heater-cartridge',
  '24 V heater cartridge',
  [headX - 10, hotY - 3, 162.5],
  3,
  20,
  [1, 0, 0],
  'silver',
  'Toolhead',
)
place(
  'nozzle-hex',
  'Brass nozzle hex',
  () =>
    drawPolysides(4, 6)
      .sketchOnPlane('XY')
      .extrude(3.8)
      .cut(makeCylinder(0.25, 5, [0, 0, -1])),
  [headX, hotY, 153],
  identity,
  'brass',
  'Toolhead',
)
place(
  'nozzle-tip',
  'Tapered nozzle tip',
  () =>
    sketchCircle(0.6)
      .loftWith(sketchCircle(3.5, { origin: [0, 0, 3] }))
      .cut(makeCylinder(0.2, 5, [0, 0, -1])),
  [headX, hotY, 150],
  identity,
  'brass',
  'Toolhead',
)
cylinder(
  'feed-collet',
  'Filament inlet collet',
  [headX, hotY, 266],
  4.5,
  5,
  [0, 0, 1],
  'dark',
  'Toolhead',
  1.1,
)
// 4010 fan: real aperture, hub and swept blades, bolted through four corner bosses.
const fanQ = frameQ([1, 0, 0], [0, 0, 1], [0, -1, 0])
const fanCase = place(
  '4010-fan-frame',
  '40 mm heatsink fan',
  () => roundBox(40, 40, 10, 3).cut(makeCylinder(18, 12, [0, 0, -1])),
  [headX, -85, 195],
  fanQ,
  'dark',
  'Toolhead',
)
cylinder('4010-hub', 'Fan rotor hub', [headX, -92, 195], 6, 5, [0, 1, 0], 'dark', 'Toolhead')
for (let i = 0; i < 7; i++) {
  let blade = draw([5, -2])
    .lineTo([15, -5])
    .lineTo([17, -1])
    .lineTo([8, 4])
    .close()
    .sketchOnPlane('XY')
    .extrude(1.2)
    .rotate((i * 360) / 7)
  place(
    'fan-blade-' + i,
    'Fan blade ' + (i + 1),
    () => blade,
    [headX, -92, 195],
    fanQ,
    'dark',
    'Toolhead',
  )
}
const shroud = place(
  'fan-duct',
  'Heatsink fan duct',
  () => {
    let s = roundBox(40, 40, 13, 3).cut(makeCylinder(17, 15, [0, 0, -1]))
    // Two small tabs sit against the front of the groove clamp.
    for (const x of [-10, 10]) s = s.fuse(makeBox([x - 4, 18, 4], [x + 4, 25, 8]))
    return s
  },
  [headX, -72, 195],
  fanQ,
  'plastic',
  'Toolhead',
)
shroud.holes.push({ custom: makeBox([headX - 14.1, -76, 207], [headX + 14.1, -71.9, 216]) })
for (const dx of [-10, 10])
  bolt(
    'Heatsink duct mount M3',
    [headX + dx, -80, 216],
    [0, 1, 0],
    3,
    10,
    [shroud, clamp],
    'Toolhead',
  )
for (const dx of [-16, 16])
  for (const dz of [-16, 16])
    bolt('Fan M4', [headX + dx, -95, 195 + dz], [0, 1, 0], 4, 19, [fanCase, shroud], 'Toolhead')
// A 5015-style radial blower: a hollow volute, a front intake, an impeller
// and a rectangular tangential outlet. The outlet points down into the duct.
const blowerOrigin = [headX + 47, -83, 197]
const blower = place(
  '5015-volute',
  'Part cooling blower housing',
  () => {
    const outline = draw([6, -26])
      .lineTo([24, -26])
      .lineTo([24, -4])
      .threePointsArcTo([0, 25], [24, 16])
      .threePointsArcTo([-24, 2], [-18, 21])
      .threePointsArcTo([-2, -23], [-20, -15])
      .lineTo([6, -23])
      .close()
    let s = outline
      .sketchOnPlane('XY')
      .extrude(15)
      .cut(makeCylinder(21, 12, [0, 0, 1.5]))
      .cut(makeBox([8, -27, 1.5], [22, -8, 13.5]))
      .cut(makeCylinder(17.2, 3, [0, 0, 13.4]))
    // Mounting ears are outside the intake, at opposite corners.
    for (const [x, y] of [
      [20, 19],
      [-20, -19],
    ])
      s = s.fuse(makeCylinder(5, 15, [x, y, 0]))
    return s
  },
  blowerOrigin,
  fanQ,
  'dark',
  'Toolhead',
)
cylinder(
  'blower-impeller-disc',
  'Blower impeller back disc',
  [headX + 47, -86, 197],
  16.4,
  0.8,
  [0, -1, 0],
  'white',
  'Toolhead',
)
cylinder(
  'blower-hub',
  'Blower impeller hub',
  [headX + 47, -86.8, 197],
  5.5,
  8,
  [0, -1, 0],
  'dark',
  'Toolhead',
)
for (let i = 0; i < 18; i++) {
  const blade = draw([6.5, -0.7])
    .threePointsArcTo([15.8, -2.6], [11.8, -2.8])
    .lineTo([16, -1.4])
    .threePointsArcTo([6.5, 0.5], [11.8, -1.6])
    .close()
    .sketchOnPlane('XY')
    .extrude(7)
    .rotate(i * 20)
  place(
    'blower-blade-' + i,
    'Blower impeller blade ' + (i + 1),
    () => blade,
    [headX + 47, -86.8, 197],
    fanQ,
    'white',
    'Toolhead',
  )
}
const blowerArm = place(
  'blower-side-bracket',
  'Part fan mounting bracket',
  () => {
    // A narrow rib reaches back to the carriage; two rear arms support the ears.
    const arms = draw([46, 230])
      .lineTo([56, 230])
      .lineTo([101, 222])
      .lineTo([103, 208])
      .lineTo([94, 208])
      .lineTo([94, 215])
      .lineTo([55, 223])
      .lineTo([55, 216])
      .lineTo([61, 181])
      .lineTo([58, 171])
      .lineTo([48, 171])
      .lineTo([48, 181])
      .lineTo([50, 220])
      .lineTo([46, 220])
      .close()
      .sketchOnPlane('XZ', 79)
      .extrude(4)
    return arms
      .fuse(makeBox([48, -79, 218], [54, -46, 230]))
      .fuse(makeBox([44, -50, 209], [54, -46, 232]))
  },
  [0, 0, 0],
  identity,
  'plastic',
  'Toolhead',
)
for (const z of [211, 225])
  bolt(
    'Part fan to tool plate M3',
    [49, -50, z],
    [0, 1, 0],
    3,
    10,
    [blowerArm, toolPlate],
    'Toolhead',
  )
for (const [x, z] of [
  [headX + 67, 216],
  [headX + 27, 178],
])
  bolt('Part fan bracket M3', [x, -98, z], [0, 1, 0], 3, 20, [blower, blowerArm], 'Toolhead')
place(
  'part-cooling-air-duct',
  'Hollow part cooling duct',
  () => {
    // Every section keeps its width direction along the projected Y axis.
    // This prevents the 90-degree twist that unrelated XY/YZ sections produce.
    const stations = [
      { p: [90, -90.5, 175], n: [0, 0, -1], w: 17, h: 20 },
      { p: [90, -90.5, 171], n: [0, 0, -1], w: 17, h: 20 },
      { p: [87, -89, 164], n: [-0.55, 0.12, -0.82], w: 14, h: 17 },
      { p: [72, -82, 157], n: [-0.92, 0.3, -0.25], w: 12, h: 12 },
      { p: [55, -73, 153.5], n: [-0.88, 0.43, -0.15], w: 13, h: 8 },
      { p: [42, -66, 151.5], n: [-0.9, 0.42, -0.12], w: 16, h: 7 },
    ]
    const loftShell = (inner) => {
      const sections = stations.map((s, i) => {
        const normal = v(s.n).normalize()
        const width = v([0, 1, 0]).projectOnPlane(normal).normalize()
        let point = s.p
        if (inner && i === 0) point = add(point, [0, 0, 0.5])
        if (inner && i === stations.length - 1)
          point = add(point, normal.multiplyScalar(1.5).toArray())
        const plane = new Plane(point, width.toArray(), s.n)
        return drawRoundedRectangle(
          s.w - (inner ? 3 : 0),
          s.h - (inner ? 3 : 0),
          0.6,
        ).sketchOnPlane(plane)
      })
      return sections[0].loftWith(sections.slice(1))
    }
    const outer = loftShell(false),
      inner = loftShell(true)
    const socket = drawRoundedRectangle(18.3, 15.3, 1)
      .sketchOnPlane('XY', 171)
      .extrude(5)
      .translate([90, -90.5, 0])
    return outer.cut(inner).cut(socket)
  },
  [0, 0, 0],
  identity,
  'plastic',
  'Toolhead',
)
cable(
  'Heater wires',
  [
    [headX + 10, hotY - 3, 162.5],
    [headX + 18, -54, 177],
    [headX + 22, -47, 208],
  ],
  1.3,
  'red',
)
cable(
  'Thermistor wires',
  [
    [headX - 8, hotY + 6, 161],
    [headX - 17, -52, 180],
    [headX - 19, -43, 208],
  ],
  0.8,
  'wire',
)

console.log('Building spool, wiring and controls…')
const holderFoot = box(
  'spool-holder-foot',
  'Spool holder foot',
  [66, 20, 480],
  48,
  32,
  4,
  'plastic',
  'Spool',
  3,
)
const holder = box(
  'spool-holder',
  'Spool holder upright',
  [66, 20, 484],
  20,
  32,
  110,
  'plastic',
  'Spool',
  3,
)
bore(holder, [55, 20, 572], [1, 0, 0], 24.1, 22)
for (const x of [54, 78]) slotBolt('Spool holder M5', [x, 20, 484], [0, 0, -1], holderFoot, 'Spool')
const spoolCentre = [112, 20, 572]
cylinder('spool-axle', 'Spool axle', [56, 20, 572], 12, 110, [1, 0, 0], 'silver', 'Spool')
const flange = () => {
  let s = drawCircle(80).cut(drawCircle(13)).sketchOnPlane('XY').extrude(4)
  for (let i = 0; i < 6; i++) {
    const slot = drawRoundedRectangle(18, 32, 5)
      .translate(0, 51)
      .rotate(i * 60)
      .sketchOnPlane('XY', -1)
      .extrude(6)
    s = s.cut(slot)
  }
  return s
}
for (const x of [82, 142])
  place(
    'spool-flange',
    'Spoked spool flange',
    flange,
    [x, 20, 572],
    axisQ([1, 0, 0]),
    'dark',
    'Spool',
  )
cylinder(
  'spool-core',
  'Spool central barrel',
  [86, 20, 572],
  33,
  56,
  [1, 0, 0],
  'dark',
  'Spool',
  13,
)
cylinder(
  'filament-roll',
  'Wound filament',
  [86, 20, 572],
  73,
  56,
  [1, 0, 0],
  'filament',
  'Spool',
  34,
)
for (let i = 0; i < 28; i++)
  cylinder(
    'filament-groove',
    'Filament winding groove',
    [87 + i * 2, 20, 572],
    73.25,
    0.55,
    [1, 0, 0],
    'filament',
    'Spool',
    72.6,
  )
cable(
  'Filament path',
  [
    [112, -53, 572],
    [97, -104, 583],
    [58, -120, 449],
    [headX, -96, 335],
    [headX, hotY, 270],
  ],
  0.875,
  'filament',
  'Spool',
)
// Rear braces are outside the build envelope and attached on the post side faces.
for (const side of [-1, 1]) {
  const brace = extrusion('Rear portal brace', [side * 200, 48, 264], [side * 200, 185, 43])
  brace.holes.push({ custom: makeBox([-230, 140, -50], [230, 210, 40]) })
  const bracket = box(
    'brace-plate',
    'Rear brace connection plate',
    [side * 214, 40, 260],
    44,
    58,
    4,
    'silver',
    'Frame',
    3,
    axisQ([-side, 0, 0]),
  )
  slotBolt('Rear brace upper M5', [side * 214, 20, 260], [-side, 0, 0], bracket)
  const lower = box(
    'brace-lower-plate',
    'Rear brace lower plate',
    [side * 214, 180, 42],
    34,
    44,
    4,
    'silver',
    'Frame',
    3,
    axisQ([-side, 0, 0]),
  )
  slotBolt('Rear brace base M5', [side * 214, 170, 30], [-side, 0, 0], lower)
  for (const [plate, y, z] of [
    [bracket, 48, 264],
    [lower, 181, 49.5],
  ]) {
    const axis = [-side, 0, 0]
    const nut = place(
      'M5-hex-nut',
      'Rear brace through-bolt nut',
      () => drawPolysides(4.6, 6).sketchOnPlane('XY').extrude(4),
      [side * 189, y, z],
      axisQ(axis),
      'steel',
      'Frame',
    )
    cylinder(
      'M5-washer',
      'Rear brace washer',
      [side * 190, y, z],
      5,
      1,
      axis,
      'steel',
      'Frame',
      2.65,
    )
    bolt('Rear brace through M5', [side * 214, y, z], axis, 5, 30, [plate, brace, nut], 'Frame')
  }
}
const electronics = place(
  'electronics-case',
  'Controller enclosure',
  () => roundBox(66, 128, 145, 5).cut(makeBox([-30, -61, 3], [30, 61, 142])),
  [-246, 105, 45],
  identity,
  'dark',
  'Electronics',
)
for (let z = 75; z < 155; z += 9)
  electronics.holes.push({ custom: makeBox([-282, 67, z], [-275, 145, z + 3]) })
for (const y of [54, 156])
  for (const z of [60, 175]) {
    const boss = cylinder(
      'case-boss',
      'Controller cover screw boss',
      [-276, y, z],
      4.5,
      10,
      [1, 0, 0],
      'dark',
      'Electronics',
    )
    bolt('Controller cover M3', [-279, y, z], [1, 0, 0], 3, 10, [electronics, boss], 'Electronics')
  }
const pcbQ = frameQ([0, 1, 0], [0, 0, 1], [1, 0, 0])
box(
  'controller-PCB',
  'Controller PCB',
  [-268, 105, 117],
  112,
  92,
  1.6,
  'pcb',
  'Electronics',
  1,
  pcbQ,
)
for (const y of [75, 100, 125, 147])
  box(
    'stepper-driver',
    'Motor driver module',
    [-266, y, 117],
    17,
    28,
    5,
    'dark',
    'Electronics',
    1,
    pcbQ,
  )
const psu = place(
  'PSU',
  '24 V power supply enclosure',
  () => roundBox(62, 150, 165, 3).cut(makeBox([-29, -73, 2], [29, 73, 163])),
  [244, 112, 45],
  identity,
  'silver',
  'Electronics',
)
for (let z = 95; z < 190; z += 11)
  for (let y = 70; y < 158; y += 11) bore(psu, [276, y, z], [-1, 0, 0], 4.5, 8)
// Both housings are bolted to two printed saddles on their base side extrusion.
for (const side of [-1, 1])
  for (const y of [72, 145]) {
    const saddle = box(
      'electronic-saddle',
      'Electronics frame saddle',
      [side * 213, y, 40],
      26,
      24,
      5,
      'plastic',
      'Electronics',
      2,
    )
    slotBolt('Electronics saddle M5', [side * 200, y, 45], [0, 0, -1], saddle, 'Electronics')
    const nut = place(
      'case-floor-M3-nut',
      'Enclosure floor M3 nut',
      () => drawPolysides(3.2, 6).sketchOnPlane('XY').extrude(2.5),
      [side * 219, y, 37.5],
      identity,
      'steel',
      'Electronics',
    )
    bolt(
      'Enclosure floor M3',
      [side * 219, y, 48],
      [0, 0, -1],
      3,
      12,
      [side < 0 ? electronics : psu, saddle, nut],
      'Electronics',
    )
  }
const panelQ = frameQ([1, 0, 0], [0, 0.5, 0.8660254], [0, -0.8660254, 0.5])
const ui = box(
  'LCD-housing',
  'Angled control panel',
  [115, -241, 67],
  132,
  62,
  15,
  'plastic',
  'Controls',
  6,
  panelQ,
)
const facePoint = (p) => add(ui.p, v(p).applyQuaternion(panelQ).toArray())
box('LCD-bezel', 'LCD bezel', facePoint([-15, 2, 15]), 90, 37, 2, 'dark', 'Controls', 2, panelQ)
box(
  'LCD-glass',
  'LCD glass',
  facePoint([-15, 2, 17.1]),
  78,
  27,
  0.4,
  'screen',
  'Controls',
  1,
  panelQ,
)
cylinder(
  'encoder-knob',
  'Rotary encoder knob',
  facePoint([48, 2, 15]),
  9,
  12,
  v([0, 0, 1]).applyQuaternion(panelQ).toArray(),
  'dark',
  'Controls',
)
cylinder(
  'control-button',
  'Back button',
  facePoint([48, -18, 15]),
  3.5,
  2,
  v([0, 0, 1]).applyQuaternion(panelQ).toArray(),
  'white',
  'Controls',
)
for (const x of [-52, 52]) {
  const arm = place(
    'LCD-arm',
    'Display mounting arm',
    () =>
      draw([-210, 40])
        .lineTo([-210, 44])
        .lineTo([-230, 44])
        .lineTo([-241, 67])
        .lineTo([-256, 41])
        .lineTo([-230, 40])
        .close()
        .sketchOnPlane('YZ')
        .extrude(14),
    [115 + x - 7, 0, 0],
    identity,
    'dark',
    'Controls',
  )
  slotBolt('Display frame mount M5', [115 + x, -220, 44], [0, 0, -1], arm, 'Controls')
  const point = facePoint([x, -12, 15])
  bolt(
    'Display housing M3',
    point,
    v([0, 0, -1]).applyQuaternion(panelQ).toArray(),
    3,
    18,
    [ui, arm],
    'Controls',
  )
}
cable(
  'Toolhead cable loom',
  [
    [headX + 15, -50, 267],
    [headX + 5, -15, 300],
    [-100, 44, 337],
    [-212, 39, 305],
    [-212, 39, 285],
    [-212, 39, 250],
    [-212, 39, 242],
    [-234, 96, 188],
  ],
  4,
  'wire',
)
cable(
  'Bed heater loom',
  [
    [90, bedY + 100, 77],
    [125, 140, 75],
    [150, 178, 49],
    [-223, 158, 60],
  ],
  3,
  'wire',
)
for (const z of [242, 285]) {
  const clip = place(
    'wire-clip',
    'Cable retaining clip',
    () =>
      roundBox(36, 4, 16, 1)
        .translate([0, 32, 0])
        .fuse(makeCylinder(6, 12, [-12, 39, 0]).cut(makeCylinder(4.2, 14, [-12, 39, -1]))),
    [-200, 0, z],
    identity,
    'plastic',
    'Wiring',
  )
  slotBolt('Cable clip M5', [-200, 34, z + 8], [0, -1, 0], clip, 'Wiring')
}
// A recognisable print on the bed: a ribbed mounting bracket, not a loose decorative object.
const sample = place(
  'sample-bracket',
  'Printed example bracket',
  () => {
    let s = roundBox(58, 40, 5, 4).fuse(makeBox([-29, 12, 5], [29, 20, 57]))
    for (const x of [-20, 20]) s = s.cut(makeCylinder(2.2, 8, [x, -10, -1]))
    for (const x of [-18, 18]) s = s.cut(makeCylinder(3.5, 12, [x, 11, 40], [0, 1, 0]))
    for (const x of [-17, 17]) {
      const rib = draw([0, 0])
        .lineTo([26, 0])
        .lineTo([26, 40])
        .close()
        .sketchOnPlane('YZ')
        .extrude(4)
        .translate([x - 2, -10, 5])
      s = s.fuse(rib)
    }
    return s
  },
  [28, -40, 84.2],
  identity,
  'filament',
  'Build plate',
)

console.log(`Checking ${connections.length} bolted joints and cutting their clearances…`)
let cutCount = 0
for (const item of specs) {
  if (!item.definition.shape) continue
  let local = item.definition.shape.clone()
  const inverseQ = item.q.clone().invert()
  for (const hole of item.holes) {
    if (hole.custom) {
      const localTool = transformed(
        hole.custom.clone().translate(mul(item.p, -1)),
        [0, 0, 0],
        inverseQ,
      )
      local = local.cut(localTool)
      continue
    }
    const point = v(hole.point).sub(v(item.p)).applyQuaternion(inverseQ).toArray()
    const axis = v(hole.axis).applyQuaternion(inverseQ).toArray()
    const cutter = makeCylinder(hole.d / 2, hole.length, point, axis)
    const overlap = measureVolume(item.definition.shape.intersect(cutter))
    if (overlap < 0.1) {
      checks.push({
        severity: 'error',
        part: item.id,
        name: item.name,
        point: hole.point,
        message: 'Bore misses target material',
      })
    }
    local = local.cut(cutter)
    if (hole.counter)
      local = local.cut(makeCylinder(hole.counter / 2, hole.counterDepth, point, axis))
    cutCount++
  }
  if (item.holes.length) {
    item.definition = { key: item.definition.key + '-' + item.id, shape: local }
    definitions.set(item.definition.key, item.definition)
  }
}
if (checks.length) throw new Error('Mechanical audit failed: ' + JSON.stringify(checks))
const groups = new Map()
const doc = {
  format: 'openkitcad',
  version: 2,
  name: 'OpenKitCAD Cartesian 3D printer',
  units: 'mm',
  parameters: [],
  bindings: [],
  rootComponentId: 'root',
  components: [
    { id: 'root', name: 'Cartesian 3D printer', source: { kind: 'design' }, bodies: [] },
  ],
  occurrences: [],
  timeline: [],
  marker: null,
  groups: [],
  meshData: {},
}
const scene = { name: doc.name, geometries: {}, instances: [], connections, checks }
const used = new Set(specs.map((s) => s.definition.key))
let index = 0,
  triangleCount = 0
for (const def of definitions.values()) {
  if (!used.has(def.key)) continue
  let positions, normals, triangles
  if (def.shape) {
    const m = def.shape.mesh({ tolerance: 0.15, angularTolerance: 0.15 })
    positions = m.vertices
    normals = m.normals
    triangles = m.triangles
  } else {
    const g = def.geometry
    positions = Array.from(g.attributes.position.array)
    normals = Array.from(g.attributes.normal.array)
    triangles = g.index
      ? Array.from(g.index.array)
      : Array.from({ length: positions.length / 3 }, (_, i) => i)
  }
  def.geometryId = 'geometry-' + ++index
  scene.geometries[def.geometryId] = { positions, normals, triangles }
  triangleCount += triangles.length / 3
  const encode = (array) =>
    Buffer.from(deflateSync(new Uint8Array(array.buffer), { level: 6 })).toString('base64')
  const encoded = {
    positions: encode(Float32Array.from(positions)),
    triangles: encode(Uint32Array.from(triangles)),
  }
  const dataId =
    'mesh-' + createHash('sha256').update(JSON.stringify(encoded)).digest('hex').slice(0, 32)
  doc.meshData[dataId] = encoded
  doc.components.push({
    id: 'component-' + def.geometryId,
    name: def.key,
    source: { kind: 'design' },
    bodies: [{ id: 'body-' + def.geometryId, name: def.key, visible: true, colour: '#999999' }],
  })
  doc.timeline.push({
    id: 'feature-' + def.geometryId,
    name: def.key,
    componentId: 'component-' + def.geometryId,
    kind: 'meshInsert',
    bodyId: 'body-' + def.geometryId,
    dataId,
    transform: new THREE.Matrix4().elements,
    unit: 'mm',
    yUp: false,
    centre: false,
    ground: false,
  })
}
// Components are shared only when both geometry and finish match.
const finishComponents = new Map()
for (const item of specs) {
  if (!groups.has(item.group)) {
    const id = 'group-' + groups.size
    groups.set(item.group, id)
    doc.components.push({ id, name: item.group, source: { kind: 'design' }, bodies: [] })
    doc.occurrences.push({
      id,
      parentComponentId: 'root',
      componentId: id,
      name: item.group,
      transform: new THREE.Matrix4().elements,
      visible: true,
      grounded: true,
    })
  }
  const geom = item.definition.geometryId,
    key = geom + '-' + item.material
  if (!finishComponents.has(key)) {
    const original = doc.components.find((c) => c.id === 'component-' + geom)
    const component = {
      ...original,
      id: 'finished-' + key,
      name: item.name,
      bodies: [
        {
          ...original.bodies[0],
          id: 'body-' + key,
          name: item.name,
          colour: colours[item.material],
        },
      ],
    }
    doc.components.push(component)
    doc.timeline.push({
      ...doc.timeline.find((f) => f.id === 'feature-' + geom),
      id: 'feature-' + key,
      name: item.name,
      componentId: component.id,
      bodyId: 'body-' + key,
    })
    finishComponents.set(key, component.id)
  }
  const matrix = new THREE.Matrix4().compose(v(item.p), item.q, new THREE.Vector3(1, 1, 1)).elements
  doc.occurrences.push({
    id: item.id,
    parentComponentId: groups.get(item.group),
    componentId: finishComponents.get(key),
    name: item.name,
    transform: matrix,
    visible: true,
    grounded: true,
  })
  scene.instances.push({
    id: item.id,
    name: item.name,
    geometry: geom,
    matrix,
    material: item.material,
    colour: colours[item.material],
    group: item.group,
  })
}
// Drop intermediate, unused uncoloured components/features.
doc.components = doc.components.filter((c) => !c.id.startsWith('component-'))
doc.timeline = doc.timeline.filter((f) => !/^feature-geometry-\d+$/.test(f.id))
writeFileSync(resolve(out, 'printer.okc'), JSON.stringify(doc))
writeFileSync(resolve(out, 'printer-scene.json'), JSON.stringify(scene))
writeFileSync(
  resolve(out, 'mechanical-audit.json'),
  JSON.stringify(
    {
      parts: specs.length,
      uniqueGeometries: index,
      triangles: triangleCount,
      bores: cutCount,
      connections,
      checks,
    },
    null,
    2,
  ),
)
console.log(
  JSON.stringify({
    parts: specs.length,
    geometries: index,
    triangles: triangleCount,
    bores: cutCount,
    errors: checks.length,
  }),
)
if (process.argv.includes('--step')) {
  console.log('Exporting BRep STEP assembly…')
  const cad = specs
    .filter((s) => s.definition.shape)
    .map((s) => ({
      shape: transformed(s.definition.shape, s.p, s.q),
      name: s.name,
      color: colours[s.material],
    }))
  const step = exportSTEP(cad, { unit: 'MM', modelUnit: 'MM' })
  writeFileSync(resolve(out, 'OpenKitCAD-3D-printer.step'), Buffer.from(await step.arrayBuffer()))
}
