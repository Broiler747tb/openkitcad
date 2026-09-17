import * as Comlink from 'comlink'
import type { Vec2, Vec3 } from '../core/math'
import {
  fitParameterName,
  linkFitClass,
  shortestSnapArm,
  snapStrain,
  snapStrainLimit,
} from '../doc/fits'
import { resolveParameters } from '../doc/parameters'
import { useStore } from '../doc/store'
import { editFeature } from '../ui/command/commands'
import { useCommand } from '../ui/command/session'
import { classGap, FIT_COMMANDS, fitStartOptions } from '../ui/command/specs/fit'
import { createCommandState, evaluateCommand, reduceCommand } from '../ui/command/state'
import type { CommandContext, CommandInitialValues, SelectionPick } from '../ui/command/types'
import type {
  BayonetFeature,
  Body,
  BodyOperation,
  DovetailFeature,
  Feature,
  FitPinsFeature,
  HingeFeature,
  LipGrooveFeature,
  OkcDocument,
  PlaneRef,
  SnapFitFeature,
  SnapRingFeature,
} from '../doc/types'
import { emptyDocument } from '../doc/types'
import type { BodyMesh, EvaluateResult, KernelApi } from '../kernel/types'
import type { TestResult } from './selftest'

const XY = (offset = 0): PlaneRef => ({ kind: 'named', name: 'XY', offset })

const face = (bodyId: string, name: string) => ({ bodyId, kind: 'face' as const, name })

const onFace = (bodyId: string, name: string): PlaneRef => ({
  kind: 'face',
  face: face(bodyId, name),
  offset: 0,
})

function body(id: string): Body {
  return { id, name: id, visible: true, colour: '#cccccc' }
}

function box(
  id: string,
  bodyId: string,
  origin: Vec2,
  size: Vec3,
  offset = 0,
  result: BodyOperation = { kind: 'newBody', bodyId },
): Feature {
  return {
    id,
    name: id,
    componentId: 'root',
    kind: 'box',
    plane: XY(offset),
    origin,
    width: size[0],
    depth: size[1],
    height: size[2],
    result,
  }
}

function cylinder(
  id: string,
  radius: number,
  height: number,
  offset: number,
  result: BodyOperation,
): Feature {
  return {
    id,
    name: id,
    componentId: 'root',
    kind: 'cylinder',
    plane: XY(offset),
    centre: [0, 0],
    radius,
    height,
    result,
  }
}

function doc(features: Feature[], bodies: string[]): OkcDocument {
  const out = emptyDocument('Fits')
  out.timeline = structuredClone(features)
  out.components[0].bodies = bodies.map(body)
  return out
}

function piecesOf(mesh: BodyMesh | undefined): number {
  if (!mesh) return 0
  const { vertices, triangles } = mesh.mesh
  const welded = new Map<string, number>()
  const parent: number[] = []
  const node = (index: number) => {
    const key = [0, 1, 2].map((axis) => Math.round(vertices[index * 3 + axis] * 1000)).join()
    let id = welded.get(key)
    if (id === undefined) {
      id = parent.length
      parent.push(id)
      welded.set(key, id)
    }
    return id
  }
  const find = (id: number): number => {
    while (parent[id] !== id) {
      parent[id] = parent[parent[id]]
      id = parent[id]
    }
    return id
  }
  for (let t = 0; t < triangles.length; t += 3) {
    const a = find(node(triangles[t]))
    parent[find(node(triangles[t + 1]))] = a
    parent[find(node(triangles[t + 2]))] = a
  }
  return new Set(parent.map((_, id) => find(id))).size
}

function meshFor(result: EvaluateResult, bodyId: string): BodyMesh | undefined {
  const instance = result.instances.find((candidate) => candidate.bodyId === bodyId)
  return instance ? result.meshes.find((mesh) => mesh.key === instance.meshKey) : undefined
}

const base = { componentId: 'root' }

function snap(patch: Partial<SnapFitFeature> = {}): SnapFitFeature {
  return {
    ...base,
    id: 'snap',
    name: 'Snap Fit',
    kind: 'snapFit',
    bodyId: 'lid',
    mateBodyId: 'case',
    plane: onFace('lid', 'ld:-z'),
    position: [2, -15],
    angle: 180,
    length: 10,
    thickness: 1.6,
    width: 6,
    hookDepth: 1,
    retention: 'permanent',
    material: 'petg',
    through: false,
    gap: 0.2,
    fitClass: 'snug',
    ...patch,
  }
}

const enclosure = [
  box('bx', 'case', [0, 0], [40, 30, 20]),
  {
    ...base,
    id: 'sh',
    name: 'Hollow',
    kind: 'shell' as const,
    bodyId: 'case',
    thickness: 2,
    openFaces: [face('case', 'bx:+z')],
  },
  box('ld', 'lid', [0, 0], [40, 30, 2], 20),
]

const CASE_VOLUME = 40 * 30 * 20 - 36 * 26 * 18
const LID_VOLUME = 40 * 30 * 2

export async function runFitTest(): Promise<TestResult[]> {
  const out: TestResult[] = []
  const add = (name: string, pass: boolean, detail: string) =>
    out.push({ name: `Fits: ${name}`, pass, detail })
  const worker = new Worker(new URL('../kernel/worker.ts', import.meta.url), { type: 'module' })
  const kernel = Comlink.wrap<KernelApi>(worker)
  const evaluate = (d: OkcDocument) => kernel.evaluate(d, [])
  const problems = (result: EvaluateResult, severity: 'error' | 'warning') =>
    result.errors.filter((error) => error.severity === severity)
  const said = (result: EvaluateResult) =>
    result.errors.map((error) => `${error.severity}: ${error.message}`).join('; ') || 'clean'
  const clean = (result: EvaluateResult) => result.errors.length === 0

  const overlap = async (features: Feature[], bodies: string[], a: string, b: string) => {
    const result = await evaluate(
      doc(
        [
          ...features,
          {
            ...base,
            id: 'probe',
            name: 'Probe',
            kind: 'combine',
            bodyId: a,
            toolBodyIds: [b],
            operation: 'intersect',
            keepTools: true,
          },
        ],
        bodies,
      ),
    )
    const mesh = meshFor(result, a)
    return { volume: mesh?.volume ?? 0, errors: problems(result, 'error') }
  }

  const check = async (name: string, run: () => Promise<void>) => {
    try {
      await run()
    } catch (error) {
      add(name, false, `threw: ${(error as Error)?.message ?? error}`)
    }
  }

  try {
    await kernel.ready()

    {
      const strainy = { length: 0, thickness: 1.6, hookDepth: 1, retention: 'permanent' as const }
      const arm = shortestSnapArm({ ...strainy, material: 'pla' })
      const strain = snapStrain({ ...strainy, length: arm })
      add(
        'the shortest safe arm bends exactly as far as the plastic allows',
        Math.abs(strain - snapStrainLimit('pla')) < 1e-9,
        `${arm.toFixed(2)} mm arm bends ${(strain * 100).toFixed(3)}%`,
      )
    }

    {
      const d = doc(enclosure, ['case', 'lid'])
      d.timeline.push(snap())
      linkFitClass(d, 'snap', 'sliding', 0.3)
      const parameter = d.parameters.find((p) => p.name === fitParameterName('sliding'))
      parameter!.expression = '0.35 mm'
      resolveParameters(d)
      const linked = (d.timeline[3] as SnapFitFeature).gap
      linkFitClass(d, 'snap', 'snug', 0.2)
      const switched = d.bindings.filter((b) => b.featureId === 'snap')
      d.bindings.push({ featureId: 'other', field: 'gap', expression: 'my_gap' })
      linkFitClass(d, 'snap', undefined, 0)
      const custom = d.bindings.filter((b) => b.featureId === 'snap').length
      d.bindings = d.bindings.filter((b) => b.featureId !== 'other')
      d.bindings.push({ featureId: 'snap', field: 'gap', expression: 'my_gap' })
      linkFitClass(d, 'snap', undefined, 0)
      const kept = d.bindings.some((b) => b.expression === 'my_gap')
      add(
        'a fit class is a design parameter the gap follows',
        linked === 0.35 &&
          switched.length === 1 &&
          switched[0].expression === 'fit_snug' &&
          custom === 0 &&
          kept &&
          d.parameters.some((p) => p.name === 'fit_snug' && p.value === 0.2),
        `gap ${linked}, then ${switched.map((b) => b.expression).join()}, custom leaves ${custom}, own link kept ${kept}`,
      )
    }

    await check('snap hook', async () => {
      const result = await evaluate(doc([...enclosure, snap()], ['case', 'lid']))
      const lid = meshFor(result, 'lid')
      const shell = meshFor(result, 'case')
      const gained = (lid?.volume ?? 0) - LID_VOLUME
      const lost = CASE_VOLUME - (shell?.volume ?? CASE_VOLUME)
      add(
        'a cantilever hook grows on the lid and cuts its catch into the wall',
        clean(result) && gained > 95 && gained < 125 && lost > 20 && lost < 50,
        `${said(result)}; lid +${gained.toFixed(1)} mm3, case -${lost.toFixed(1)} mm3`,
      )
      add(
        'the hook is part of the lid, and the case stays in one piece',
        piecesOf(lid) === 1 && piecesOf(shell) === 1,
        `lid ${piecesOf(lid)} piece(s), case ${piecesOf(shell)}`,
      )
      const through = await evaluate(doc([...enclosure, snap({ through: true })], ['case', 'lid']))
      const throughLost = CASE_VOLUME - (meshFor(through, 'case')?.volume ?? CASE_VOLUME)
      const extra = throughLost - lost
      const expected = (2 - 1.2) * 6.4 * (10.2 - (10 - 1 / Math.tan(Math.PI / 6) - 0.4 - 0.2))
      add(
        'a window through the wall stops at the far side of that wall',
        clean(through) && Math.abs(extra - expected) < 3,
        `${said(through)}; ${extra.toFixed(1)} mm3 more removed, expected about ${expected.toFixed(1)}`,
      )
      const clash = await overlap([...enclosure, snap()], ['case', 'lid'], 'lid', 'case')
      add(
        'the lid and the case do not overlap anywhere',
        clash.volume < 0.01,
        `${clash.volume.toFixed(4)} mm3 shared${clash.errors.length ? `; ${clash.errors[0].message}` : ''}`,
      )
      const stiff = await evaluate(
        doc(
          [...enclosure, snap({ thickness: 3, hookDepth: 2, length: 9, material: 'pla' })],
          ['case', 'lid'],
        ),
      )
      add(
        'a stubby hook in PLA warns it may crack',
        problems(stiff, 'error').length === 0 &&
          problems(stiff, 'warning').some((w) => w.message.includes('crack')),
        said(stiff),
      )
      const adrift = await evaluate(
        doc([...enclosure, snap({ position: [15, -15] })], ['case', 'lid']),
      )
      add(
        'a hook placed away from every wall says it does not reach',
        problems(adrift, 'warning').some((w) => w.message.includes('does not reach')),
        said(adrift),
      )
      const short = await evaluate(
        doc([...enclosure, snap({ length: 2, hookDepth: 1.5 })], ['case', 'lid']),
      )
      add(
        'an arm too short for its hook is refused',
        problems(short, 'error').some((e) => e.message.includes('too short')),
        said(short),
      )
    })

    const plates = [
      box('p1', 'bottom', [0, 0], [30, 30, 5]),
      box('p2', 'top', [0, 0], [30, 30, 5], 5),
    ]
    const pins = (patch: Partial<FitPinsFeature> = {}): FitPinsFeature => ({
      ...base,
      id: 'pins',
      name: 'Pins',
      kind: 'fitPins',
      bodyId: 'bottom',
      mateBodyId: 'top',
      plane: onFace('bottom', 'p1:+z'),
      positions: [
        [8, 8],
        [22, 22],
      ],
      diameter: 3,
      height: 4,
      gap: 0.1,
      fitClass: 'press',
      ...patch,
    })

    await check('pins', async () => {
      const result = await evaluate(doc([...plates, pins()], ['bottom', 'top']))
      const gained = (meshFor(result, 'bottom')?.volume ?? 0) - 4500
      const lost = 4500 - (meshFor(result, 'top')?.volume ?? 4500)
      const pin = Math.PI * 1.5 ** 2 * 4
      const socket = Math.PI * 1.6 ** 2 * 4.3
      add(
        'pins stand on one plate and sockets sink into the other',
        clean(result) &&
          gained < 2 * pin &&
          gained > 2 * pin - 5 &&
          lost > 2 * socket &&
          lost < 2 * socket + 6,
        `${said(result)}; +${gained.toFixed(1)} (pins ${(2 * pin).toFixed(1)}), -${lost.toFixed(1)} (sockets ${(2 * socket).toFixed(1)})`,
      )
      const clash = await overlap([...plates, pins()], ['bottom', 'top'], 'bottom', 'top')
      add(
        'a pin never touches its socket',
        clash.volume < 0.01,
        `${clash.volume.toFixed(4)} mm3 shared${clash.errors.length ? `; ${clash.errors[0].message}` : ''}`,
      )
      const tall = await evaluate(doc([...plates, pins({ height: 6 })], ['bottom', 'top']))
      add(
        'pins taller than the other part is thick warn they will show',
        problems(tall, 'warning').some((w) => w.message.includes('too thin')),
        said(tall),
      )
    })

    const lip = (patch: Partial<LipGrooveFeature> = {}): LipGrooveFeature => ({
      ...base,
      id: 'lip',
      name: 'Lip',
      kind: 'lipGroove',
      bodyId: 'lower',
      mateBodyId: 'upper',
      plane: onFace('lower', 'lo:+z'),
      width: 1.2,
      height: 2,
      inset: 1,
      gap: 0.2,
      fitClass: 'snug',
      ...patch,
    })
    const halves = [
      box('lo', 'lower', [0, 0], [40, 30, 10]),
      box('up', 'upper', [0, 0], [40, 30, 3], 10),
    ]

    await check('lip', async () => {
      const result = await evaluate(doc([...halves, lip()], ['lower', 'upper']))
      const gained = (meshFor(result, 'lower')?.volume ?? 0) - 12000
      const lost = 3600 - (meshFor(result, 'upper')?.volume ?? 3600)
      const ring = (inset: number, width: number) =>
        (40 - 2 * inset) * (30 - 2 * inset) -
        (40 - 2 * (inset + width)) * (30 - 2 * (inset + width))
      const lipVolume = ring(1, 1.2) * 2
      const grooveVolume = ring(0.8, 1.6) * 2.2
      add(
        'a lip follows the edge of the face and its groove is cut a gap wider',
        clean(result) && Math.abs(gained - lipVolume) < 1 && Math.abs(lost - grooveVolume) < 1,
        `${said(result)}; lip ${gained.toFixed(1)} of ${lipVolume.toFixed(1)}, groove ${lost.toFixed(1)} of ${grooveVolume.toFixed(1)}`,
      )
      const clash = await overlap([...halves, lip()], ['lower', 'upper'], 'lower', 'upper')
      add(
        'the lip sits in its groove without touching',
        clash.volume < 0.01,
        `${clash.volume.toFixed(4)} mm3 shared`,
      )
      const pocketed = [
        box('lo', 'lower', [0, 0], [40, 30, 10]),
        box('pk', 'pocket', [2, 2], [36, 26, 8], 2, { kind: 'cut', bodyIds: ['lower'] }),
        box('up', 'upper', [0, 0], [40, 30, 3], 10),
      ]
      const overhang = await evaluate(doc([...pocketed, lip({ width: 2 })], ['lower', 'upper']))
      add(
        'a lip wider than the wall warns that it overhangs',
        problems(overhang, 'error').length === 0 &&
          problems(overhang, 'warning').some((w) => w.message.includes('hangs')),
        said(overhang),
      )
    })

    const dovetail = (patch: Partial<DovetailFeature> = {}): DovetailFeature => ({
      ...base,
      id: 'dt',
      name: 'Dovetail',
      kind: 'dovetail',
      bodyId: 'bed',
      mateBodyId: 'slider',
      plane: onFace('bed', 'bd:+z'),
      position: [20, 15],
      angle: 0,
      length: 30,
      width: 6,
      height: 3,
      flankAngle: 15,
      through: false,
      gap: 0.3,
      fitClass: 'sliding',
      ...patch,
    })
    const slide = [
      box('bd', 'bed', [0, 0], [40, 30, 10]),
      box('sl', 'slider', [0, 0], [40, 30, 6], 10),
    ]

    await check('dovetail', async () => {
      const result = await evaluate(doc([...slide, dovetail()], ['bed', 'slider']))
      const gained = (meshFor(result, 'bed')?.volume ?? 0) - 12000
      const lost = 7200 - (meshFor(result, 'slider')?.volume ?? 7200)
      const tan = Math.tan(Math.PI / 12)
      const rail = ((6 + 6 + 6 * tan) / 2) * 3 * 30
      const half0 = 3 + 0.3 / Math.cos(Math.PI / 12)
      const slot = (2 * half0 * 3.3 + tan * 3.3 * 3.3) * 35.3
      add(
        'a dovetail rail and its slot open at one end',
        clean(result) && Math.abs(gained - rail) < 1 && Math.abs(lost - slot) < 2,
        `${said(result)}; rail ${gained.toFixed(1)} of ${rail.toFixed(1)}, slot ${lost.toFixed(1)} of ${slot.toFixed(1)}`,
      )
      const clash = await overlap([...slide, dovetail()], ['bed', 'slider'], 'bed', 'slider')
      add(
        'the rail runs in its slot without touching',
        clash.volume < 0.01,
        `${clash.volume.toFixed(4)} mm3 shared`,
      )
    })

    const post = [
      cylinder('cy', 5, 12, 0, { kind: 'newBody', bodyId: 'post' }),
      box('cp', 'cap', [-8, -8], [16, 16, 10], 4),
      cylinder('bore', 5, 8, 4, { kind: 'cut', bodyIds: ['cap'] }),
    ]
    const capVolume = 16 * 16 * 10 - Math.PI * 25 * 8
    const postVolume = Math.PI * 25 * 12

    await check('snap ring', async () => {
      const ring = (patch: Partial<SnapRingFeature> = {}): SnapRingFeature => ({
        ...base,
        id: 'ring',
        name: 'Snap Ring',
        kind: 'snapRing',
        bodyId: 'post',
        mateBodyId: 'cap',
        face: face('post', 'cy:side'),
        anchor: [5, 0, 11],
        flipEnd: false,
        distance: 2,
        bead: 0.5,
        retention: 'permanent',
        slots: 0,
        gap: 0.2,
        fitClass: 'snug',
        ...patch,
      })
      const result = await evaluate(doc([...post, ring()], ['post', 'cap']))
      const gained = (meshFor(result, 'post')?.volume ?? 0) - postVolume
      const lead = 0.5 / Math.tan(Math.PI / 6)
      const area = 0.5 * lead * 0.5 + 0.4 * 0.5
      const bead = 2 * Math.PI * 5.25 * area
      const shell = meshFor(result, 'post')
      add(
        'a bead rings the post near the end the cap goes on from',
        clean(result) &&
          Math.abs(gained - bead) < 1.5 &&
          !!shell &&
          shell.bounds[5] <= 12.05 &&
          piecesOf(shell) === 1,
        `${said(result)}; bead ${gained.toFixed(2)} of about ${bead.toFixed(2)} mm3, top at ${shell?.bounds[5].toFixed(3)}`,
      )
      const lost = capVolume - (meshFor(result, 'cap')?.volume ?? capVolume)
      add(
        'the cap gets a matching groove and a clearance sleeve',
        lost > Math.PI * (5.2 ** 2 - 25) * 8 + 5,
        `-${lost.toFixed(1)} mm3`,
      )
      const clash = await overlap([...post, ring()], ['post', 'cap'], 'post', 'cap')
      add(
        'the bead and the groove do not touch',
        clash.volume < 0.01,
        `${clash.volume.toFixed(4)} mm3 shared`,
      )
      const slotted = await evaluate(doc([...post, ring({ slots: 4 })], ['post', 'cap']))
      const slotLoss =
        (meshFor(result, 'post')?.volume ?? 0) - (meshFor(slotted, 'post')?.volume ?? 0)
      add(
        'slots split the end of the post so it can flex',
        clean(slotted) && slotLoss > 20,
        `${said(slotted)}; slots take ${slotLoss.toFixed(1)} mm3`,
      )
    })

    await check('bayonet', async () => {
      const bayonet = (patch: Partial<BayonetFeature> = {}): BayonetFeature => ({
        ...base,
        id: 'bay',
        name: 'Bayonet',
        kind: 'bayonet',
        bodyId: 'post',
        mateBodyId: 'cap',
        face: face('post', 'cy:side'),
        anchor: [5, 0, 11],
        flipEnd: false,
        distance: 2,
        lugs: 3,
        width: 3,
        height: 2,
        thickness: 1,
        angle: 60,
        detent: true,
        gap: 0.3,
        fitClass: 'sliding',
        ...patch,
      })
      const result = await evaluate(doc([...post, bayonet()], ['post', 'cap']))
      const gained = (meshFor(result, 'post')?.volume ?? 0) - postVolume
      const lug = Math.PI * (36 - 25) * (3 / 5 / (2 * Math.PI)) * 2
      add(
        'bayonet lugs stand out from the post',
        clean(result) && Math.abs(gained - 3 * lug) < 1,
        `${said(result)}; ${gained.toFixed(2)} of ${(3 * lug).toFixed(2)} mm3`,
      )
      const clash = await overlap([...post, bayonet()], ['post', 'cap'], 'post', 'cap')
      add(
        'the lugs sit in their slots without touching',
        clash.volume < 0.01,
        `${clash.volume.toFixed(4)} mm3 shared`,
      )
      const loose = await evaluate(doc([...post, bayonet({ detent: false })], ['post', 'cap']))
      const bumps = (meshFor(result, 'cap')?.volume ?? 0) - (meshFor(loose, 'cap')?.volume ?? 0)
      add(
        'the click stop leaves a small bump in each slot',
        clean(loose) && bumps > 0.6 && bumps < 3 && piecesOf(meshFor(result, 'cap')) === 1,
        `${said(loose)}; bumps add ${bumps.toFixed(2)} mm3`,
      )
      const crowded = await evaluate(
        doc([...post, bayonet({ lugs: 4, angle: 80 })], ['post', 'cap']),
      )
      add(
        'too many lugs for the twist is refused',
        problems(crowded, 'error').some((e) => e.message.includes('do not fit')),
        said(crowded),
      )
      const short = await evaluate(doc([...post, bayonet({ angle: 30 })], ['post', 'cap']))
      add(
        'a twist too short for a click stop says so',
        problems(short, 'warning').some((w) => w.message.includes('click stop')),
        said(short),
      )
    })

    await check('hinge', async () => {
      const leaves = [
        box('la', 'leafA', [0, 0], [30, 20, 4]),
        box('lb', 'leafB', [30.6, 0], [30, 20, 4]),
      ]
      const hinge = (patch: Partial<HingeFeature> = {}): HingeFeature => ({
        ...base,
        id: 'hinge',
        name: 'Hinge',
        kind: 'hinge',
        bodyId: 'leafA',
        mateBodyId: 'leafB',
        plane: onFace('leafA', 'la:+z'),
        position: [30.3, 10],
        angle: 90,
        length: 18,
        knuckles: 5,
        diameter: 4,
        gap: 0.45,
        fitClass: 'loose',
        ...patch,
      })
      const result = await evaluate(doc([...leaves, hinge()], ['leafA', 'leafB']))
      const a = meshFor(result, 'leafA')
      const b = meshFor(result, 'leafB')
      add(
        'a print-in-place hinge builds knuckles on both leaves',
        clean(result) && !!a && !!b && a.volume !== 2400 && b.volume !== 2400,
        `${said(result)}; ${a?.volume.toFixed(1)} and ${b?.volume.toFixed(1)} mm3`,
      )
      add(
        'each leaf stays one piece, knuckles attached',
        piecesOf(a) === 1 && piecesOf(b) === 1,
        `${piecesOf(a)} and ${piecesOf(b)} pieces`,
      )
      const clash = await overlap([...leaves, hinge()], ['leafA', 'leafB'], 'leafA', 'leafB')
      add(
        'the leaves never touch, so they print apart',
        clash.volume < 0.01,
        `${clash.volume.toFixed(4)} mm3 shared`,
      )
      const tight = await evaluate(
        doc(
          [
            box('la', 'leafA', [0, 0], [30, 20, 4]),
            box('lb', 'leafB', [30.2, 0], [30, 20, 4]),
            hinge({ position: [30.1, 10] }),
          ],
          ['leafA', 'leafB'],
        ),
      )
      add(
        'leaves closer than the gap warn they may fuse',
        problems(tight, 'warning').some((w) => w.message.includes('stuck together')),
        said(tight),
      )
    })
    const saved = useStore.getState()
    const facePick = (bodyId: string, name: string, point: Vec3, normal: Vec3): SelectionPick => ({
      kind: 'face',
      id: `${bodyId}|${name}`,
      bodyId,
      name,
      label: 'Face',
      face: face(bodyId, name),
      point,
      normal,
    })
    const stage = async (features: Feature[], bodies: string[]) => {
      const d = doc(features, bodies)
      const result = await evaluate(d)
      useStore.setState({
        doc: d,
        activeSketch: null,
        meshes: new Map(result.meshes.map((mesh) => [mesh.key, mesh])),
        instances: result.instances,
      })
      return d
    }
    const run = async (id: string, initial: CommandInitialValues, d: OkcDocument) => {
      const spec = FIT_COMMANDS[id]
      let serial = 0
      const context: CommandContext = {
        doc: d,
        unit: d.units,
        componentId: 'root',
        id: (role) => `${role}-${++serial}`,
      }
      const evaluation = evaluateCommand(
        spec,
        createCommandState(spec, context, initial),
        context,
        {
          build: true,
        },
      )
      const built = evaluation.features
        ? await evaluate({ ...d, timeline: [...d.timeline, ...evaluation.features] })
        : null
      return { evaluation, built, feature: evaluation.features?.[0] }
    }

    try {
      await check('clicking a face', async () => {
        const d = await stage(enclosure, ['case', 'lid'])
        const start = fitStartOptions('snapFit', [
          facePick('lid', 'ld:-z', [4.5, 12, 20], [0, 0, -1]),
        ])!
        const initial = start.initial!
        const mate = (initial.mate as SelectionPick[])[0]
        add(
          'clicking the lid near a wall finds the case and puts the hook against that wall',
          mate?.bodyId === 'case' &&
            Math.abs((initial.x as number) - 2) < 0.02 &&
            Math.abs((initial.y as number) + 12) < 0.02 &&
            Math.abs(Math.abs(initial.angle as number) - 180) < 0.1,
          JSON.stringify({ x: initial.x, y: initial.y, angle: initial.angle, mate: mate?.bodyId }),
        )
        const { evaluation, built, feature } = await run('snapFit', initial, d)
        add(
          'and the hook it builds from that click catches the wall',
          !!built && clean(built) && feature?.kind === 'snapFit' && feature.mateBodyId === 'case',
          built ? said(built) : JSON.stringify(evaluation.fieldErrors),
        )

        const leaves = [
          box('la', 'leafA', [0, 0], [30, 20, 4]),
          box('lb', 'leafB', [30.6, 0], [30, 20, 4]),
        ]
        const hd = await stage(leaves, ['leafA', 'leafB'])
        const hinge = fitStartOptions('hinge', [
          facePick('leafA', 'la:+z', [28, 7, 4], [0, 0, 1]),
        ])!.initial!
        add(
          'clicking beside the other leaf puts the hinge line in the gap',
          (hinge.mate as SelectionPick[])[0]?.bodyId === 'leafB' &&
            Math.abs((hinge.x as number) - 30.3) < 0.02 &&
            Math.abs((hinge.y as number) - 7) < 0.02 &&
            Math.abs(Math.abs(hinge.angle as number) - 90) < 0.1,
          JSON.stringify({ x: hinge.x, y: hinge.y, angle: hinge.angle }),
        )
        const hinged = await run('hinge', hinge, hd)
        add(
          'and that hinge builds cleanly',
          !!hinged.built && clean(hinged.built),
          hinged.built ? said(hinged.built) : JSON.stringify(hinged.evaluation.fieldErrors),
        )

        const pd = await stage(plates, ['bottom', 'top'])
        const pinSpec = FIT_COMMANDS.fitPins
        const context: CommandContext = {
          doc: pd,
          unit: pd.units,
          componentId: 'root',
          id: (role) => role,
        }
        let state = createCommandState(pinSpec, context, { fit: 'press', gap: 0.1 })
        const click = (x: number, y: number) =>
          (state = reduceCommand(
            pinSpec,
            state,
            { type: 'pick', id: 'face', pick: facePick('bottom', 'p1:+z', [x, y, 5], [0, 0, 1]) },
            context,
          ))
        click(8, 8)
        click(22, 22)
        click(15, 8)
        click(22.5, 21.5)
        const pinValues = evaluateCommand(pinSpec, state, context, { build: true })
        const pinFeature = pinValues.features?.[0] as FitPinsFeature | undefined
        add(
          'each click on a face adds a pin, clicking a pin again removes it, and the other part is found',
          pinFeature?.positions.map((p) => p.join(':')).join() === '8:8,15:8' &&
            pinFeature.mateBodyId === 'top',
          JSON.stringify(pinFeature ?? pinValues.fieldErrors),
        )
      })

      await check('fit classes in the panel', async () => {
        const d = await stage(enclosure, ['case', 'lid'])
        d.parameters.push({
          id: 'param-fit_sliding',
          name: 'fit_sliding',
          value: 0.33,
          expression: '0.33 mm',
        })
        const spec = FIT_COMMANDS.snapFit
        const context: CommandContext = {
          doc: d,
          unit: d.units,
          componentId: 'root',
          id: (role) => role,
        }
        let state = createCommandState(spec, context, {
          face: [facePick('lid', 'ld:-z', [2, 15, 20], [0, 0, -1])],
          mate: [{ kind: 'body', id: 'case', bodyId: 'case', label: 'case' }],
          x: 2,
          y: -15,
          angle: 180,
          fit: 'snug',
          gap: classGap(d, 'snug'),
        })
        state = reduceCommand(spec, state, { type: 'choice', id: 'fit', value: 'sliding' }, context)
        const sliding = evaluateCommand(spec, state, context, { build: true }).values
        state = reduceCommand(spec, state, { type: 'text', id: 'gap', text: '0.27' }, context)
        const typed = evaluateCommand(spec, state, context, { build: true }).values
        add(
          'picking a class fills its gap from the design, and typing a gap makes it custom',
          sliding.gap === 0.33 && typed.fit === 'custom' && typed.gap === 0.27,
          `sliding ${sliding.gap}, typed ${typed.fit} ${typed.gap}`,
        )
      })

      await check('editing keeps the class link', async () => {
        const d = await stage([...enclosure, snap()], ['case', 'lid'])
        linkFitClass(d, 'snap', 'snug', 0.2)
        useStore.setState({ doc: d })
        const feature = d.timeline.find((f) => f.id === 'snap')!
        const opened = editFeature(feature)
        const session = useCommand.getState().session
        if (!opened || !session) {
          add('editing a fit reopens its panel', false, 'no panel')
          return
        }
        useCommand.getState().dispatch({ type: 'choice', id: 'fit', value: 'loose' })
        const current = useCommand.getState().session!
        const evaluation = evaluateCommand(current.spec, current.state, current.context, {
          build: true,
        })
        useCommand.getState().commit(evaluation.features!, evaluation.values)
        const after = useStore.getState().doc
        const links = after.bindings.filter((b) => b.featureId === 'snap')
        const edited = after.timeline.find((f) => f.id === 'snap') as SnapFitFeature
        add(
          'switching class while editing moves the gap link to the new class',
          links.length === 1 &&
            links[0].expression === 'fit_loose' &&
            edited.fitClass === 'loose' &&
            after.parameters.some((p) => p.name === 'fit_loose'),
          JSON.stringify({ links, fit: edited.fitClass, gap: edited.gap }),
        )
      })
    } finally {
      useCommand.getState().cancel()
      useStore.setState(saved)
    }
  } catch (error) {
    add('suite', false, `threw: ${(error as Error)?.message ?? error}`)
  } finally {
    worker.terminate()
  }
  return out
}
