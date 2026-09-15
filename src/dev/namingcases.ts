import { drawRectangle } from 'replicad'
import { NAMED_FRAMES, type Frame, type Vec3 } from '../core/math'
import type { Sketch2D } from '../sketch/types'
import {
  cut,
  extrude,
  fillet,
  finishLabel,
  fuse,
  NamingError,
  occGeometry,
  resolveElement,
  type NamedShape,
} from '../kernel/naming'
import { nameShape, transformNamed } from '../kernel/naming/extra'
import type { TestResult } from './selftest'

const keep: unknown[] = []

function rectangle(
  ids: [string, string, string, string],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Sketch2D {
  const [a, b, c, d] = ids
  return {
    points: [
      { id: a, x: x0, y: y0 },
      { id: b, x: x1, y: y0 },
      { id: c, x: x1, y: y1 },
      { id: d, x: x0, y: y1 },
    ],
    entities: [
      { id: `${a}${b}`, kind: 'line', p1: a, p2: b, construction: false },
      { id: `${b}${c}`, kind: 'line', p1: b, p2: c, construction: false },
      { id: `${c}${d}`, kind: 'line', p1: c, p2: d, construction: false },
      { id: `${d}${a}`, kind: 'line', p1: d, p2: a, construction: false },
    ],
    constraints: [],
  }
}

function prism(oc: any, featureId: string, sketch: Sketch2D, height: number, z = 0): NamedShape {
  const [p0, , p2] = sketch.points
  const w = p2.x - p0.x
  const h = p2.y - p0.y
  const face = (
    drawRectangle(w, h)
      .translate(p0.x + w / 2, p0.y + h / 2)
      .sketchOnPlane('XY', z) as any
  ).face()
  keep.push(face)
  const frame: Frame = { ...NAMED_FRAMES.XY, origin: [0, 0, z] }
  return extrude(oc, { featureId, profile: face.wrapped, sketch, frame, vector: [0, 0, height] })
}

export function runNamingCases(oc: any): TestResult[] {
  const results: TestResult[] = []
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name: `Naming: ${name}`, pass, detail })
  const attempt = (name: string, fn: () => void) => {
    try {
      fn()
    } catch (e) {
      check(name, false, `threw ${(e as Error)?.stack ?? String(e)}`)
    }
  }
  const geometry = occGeometry(oc)
  const sorted = (list: string[]) => [...list].sort()
  const centroid = (named: NamedShape, name: string): Vec3 => {
    const element = named.map.get('face', name)
    return element ? geometry.centroid('face', element.shape) : [NaN, NaN, NaN]
  }
  const show = (v: Vec3) => v.map((n) => n.toFixed(3)).join(', ')

  attempt('an extrude names its faces from the sketch', () => {
    const box = prism(oc, 'e1', rectangle(['a', 'b', 'c', 'd'], 0, 0, 40, 30), 10)
    const faces = sorted(box.map.names('face'))
    const expected = sorted([
      'e1:start',
      'e1:end',
      'e1:side:ab',
      'e1:side:bc',
      'e1:side:cd',
      'e1:side:da',
    ])
    check(
      'an extrude names its faces from the sketch',
      faces.join(' ') === expected.join(' '),
      faces.join(' '),
    )
    const edges = box.map.names('edge')
    check(
      'an extrude gives all 12 edges unique names',
      edges.length === 12 && new Set(edges).size === 12,
      sorted(edges).join(' '),
    )
    const z = centroid(box, 'e1:end')[2]
    check('the end cap is the far face', Math.abs(z - 10) < 1e-6, `end cap at z=${z}`)
  })

  attempt('a fillet keeps its edge when the extrude changes', () => {
    const build = (height: number) => {
      const box = prism(oc, 'e1', rectangle(['a', 'b', 'c', 'd'], 0, 0, 40, 30), height)
      return fillet(oc, {
        featureId: 'f1',
        bodyId: 'plate',
        body: box,
        edges: ['e1:end:ab'],
        radius: 2,
      })
    }
    const low = build(10)
    const high = build(25)
    const name = 'f1:gen:e1:end:ab'
    check(
      'a fillet face is named from its edge',
      !!low.map.get('face', name) && !!high.map.get('face', name),
      sorted(low.map.names('face')).join(' '),
    )
    const lowC = centroid(low, name)
    const highC = centroid(high, name)
    check(
      'the fillet follows the top front edge after the extrude grows',
      lowC[2] > 8 && highC[2] > 23 && lowC[1] < 2 && highC[1] < 2,
      `${show(lowC)} then ${show(highC)}`,
    )
    check(
      'face names are identical across the two rebuilds',
      sorted(low.map.names('face')).join(' ') === sorted(high.map.names('face')).join(' '),
      sorted(high.map.names('face')).join(' '),
    )
  })

  attempt('coplanar faces merge and both old names resolve', () => {
    const left = prism(oc, 'e1', rectangle(['a', 'b', 'c', 'd'], 0, 0, 20, 30), 10)
    const right = prism(oc, 'e2', rectangle(['p', 'q', 'r', 's'], 20, 0, 40, 30), 10)
    const joined = fuse(oc, { featureId: 'u1', target: left, tools: [right] })
    check(
      'coplanar faces merge into a six-faced block',
      joined.map.names('face').length === 6,
      sorted(joined.map.names('face')).join(' '),
    )
    const a = resolveElement(joined.map, { bodyId: 'b', kind: 'face', name: 'e1:end' })
    const b = resolveElement(joined.map, { bodyId: 'b', kind: 'face', name: 'e2:end' })
    check(
      'both old top names resolve to the merged face',
      a.ok && b.ok && a.element === b.element,
      JSON.stringify([
        a.ok ? a.element.name : a.error.message,
        b.ok ? b.element.name : b.error.message,
      ]),
    )
    const wall = resolveElement(joined.map, { bodyId: 'b', kind: 'face', name: 'e1:side:bc' })
    check(
      'the buried shared wall reports which feature removed it',
      !wall.ok && wall.error.code === 'deleted' && wall.error.featureId === 'u1',
      wall.ok ? `still resolves to ${wall.element.name}` : wall.error.message,
    )
  })

  attempt('a split face gets stable numbered children', () => {
    const build = () => {
      const plate = prism(oc, 'e1', rectangle(['a', 'b', 'c', 'd'], 0, 0, 40, 30), 10)
      const slot = prism(oc, 't1', rectangle(['p', 'q', 'r', 's'], 18, -5, 22, 35), 12, -1)
      return cut(oc, { featureId: 'c1', target: plate, tools: [slot] })
    }
    const first = build()
    const second = build()
    const names = sorted(first.map.names('face'))
    check(
      'the cut top splits into numbered children',
      names.includes('e1:end#1') && names.includes('e1:end#2'),
      names.join(' '),
    )
    const top = resolveElement(first.map, { bodyId: 'b', kind: 'face', name: 'e1:end' })
    check(
      'the old top name is now ambiguous',
      !top.ok && top.error.code === 'ambiguous',
      top.ok ? `resolved to ${top.element.name}` : top.error.message,
    )
    check(
      'identical rebuilds give identical names',
      names.join(' ') === sorted(second.map.names('face')).join(' '),
      sorted(second.map.names('face')).join(' '),
    )
    const x1 = centroid(first, 'e1:end#1')[0]
    const x2 = centroid(second, 'e1:end#1')[0]
    check(
      'the same numbered child is the same half each time',
      Number.isFinite(x1) && Math.abs(x1 - x2) < 1e-6,
      `x ${x1} and ${x2}`,
    )
  })

  attempt('a missing edge name is an error', () => {
    const box = prism(oc, 'e1', rectangle(['a', 'b', 'c', 'd'], 0, 0, 40, 30), 10)
    let code = ''
    try {
      fillet(oc, { featureId: 'f1', bodyId: 'plate', body: box, edges: ['e1:end:zz'], radius: 1 })
    } catch (e) {
      code = e instanceof NamingError ? e.error.code : `other: ${(e as Error).message}`
    }
    check('a missing edge name is an error, not a guess', code === 'missing', code || 'no error')
  })

  attempt('a move keeps every name', () => {
    const box = prism(oc, 'e1', rectangle(['a', 'b', 'c', 'd'], 0, 0, 40, 30), 10)
    const moved = transformNamed(oc, 'm1', box, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1])
    check(
      'a move keeps face and edge names',
      sorted(moved.map.names('face')).join(' ') === sorted(box.map.names('face')).join(' ') &&
        sorted(moved.map.names('edge')).join(' ') === sorted(box.map.names('edge')).join(' '),
      sorted(moved.map.names('face')).join(' '),
    )
    const end = centroid(moved, 'e1:end')
    check(
      'the moved end cap is where the move put it',
      Math.abs(end[0] - 120) < 1e-6 && Math.abs(end[2] - 10) < 1e-6,
      show(end),
    )
  })

  attempt('tool shapes get deterministic names', () => {
    const make = () => {
      const tool = (drawRectangle(10, 10).sketchOnPlane('XY') as any).extrude(5)
      keep.push(tool)
      return nameShape(oc, 'h1', tool.wrapped)
    }
    const a = make()
    const b = make()
    const names = sorted(a.map.names('face'))
    check(
      'a tool shape gets six unique face names',
      names.length === 6 && new Set(names).size === 6,
      names.join(' '),
    )
    check(
      'naming the same tool twice gives the same names',
      names.join(' ') === sorted(b.map.names('face')).join(' '),
      sorted(b.map.names('face')).join(' '),
    )
  })

  attempt('long names are hashed', () => {
    const table = new Map<string, string>()
    const long = 'x'.repeat(200)
    const label = finishLabel(long, long, table)
    check(
      'a long name becomes a 16-digit hash with its full form kept',
      /^[0-9a-f]{16}$/.test(label.name) && table.get(label.name) === long,
      label.name,
    )
  })

  return results
}
