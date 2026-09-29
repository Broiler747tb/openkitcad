import * as Comlink from 'comlink'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { useStore } from '../doc/store'
import { emptyDocument, type Feature, type OkcDocument } from '../doc/types'
import { canMoveEarlier } from '../doc/model'
import {
  adoptCustomParts,
  makeShareLink,
  saveAutosaveNow,
  scheduleAutosave,
  serialise,
} from '../doc/persist'
import { restoreDesign } from '../doc/boot'
import { getMeshData, putMeshData } from '../doc/meshData'
import { isKept, recallMeshes } from '../doc/meshVault'
import { entityPointIds } from '../sketch/curves'
import { constraintRefs, deleteGeometry, deleteSketchItems } from '../sketch/power'
import { sketchRegions } from '../sketch/regions'
import { emptySketch, type Sketch2D } from '../sketch/types'
import { createMesh } from '../mesh/types'
import { writeStlBinary } from '../mesh/stl'
import { parse3mf } from '../mesh/threemf'
import { strToU8, zipSync } from 'fflate'
import { loadUserParts, refreshUserParts, upsertUserPart, userParts } from '../catalogue'
import type { CataloguePart } from '../catalogue/types'
import { kernel, requestBuild, stopKernel, useKernelActivity } from '../kernel/api'
import type { EvaluateResult, KernelApi } from '../kernel/types'
import { CrashGuard } from '../ui/CrashGuard'
import { useCommand } from '../ui/command/session'
import { startCommand } from '../ui/command/commands'
import { openDroppedFile } from '../ui/fileDrop'
import { ViewportEngine } from '../viewport/engine'
import type { TestResult } from './selftest'

const AUTOSAVE = 'openkitcad.autosave.v2'
const SET_ASIDE = 'openkitcad.autosave.v2.unopened'
const USER_PARTS = 'openkitcad.userparts.v1'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(done: () => boolean, ms = 5000): Promise<boolean> {
  const end = performance.now() + ms
  while (performance.now() < end) {
    if (done()) return true
    await wait(25)
  }
  return done()
}

async function keepingStorage<T>(keys: string[], run: () => Promise<T> | T): Promise<T> {
  const saved = keys.map((key) => [key, localStorage.getItem(key)] as const)
  try {
    return await run()
  } finally {
    for (const [key, value] of saved) {
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    }
    refreshUserParts()
  }
}

function box(id: string, bodyId: string, x = 0, patch: Record<string, unknown> = {}): Feature {
  return {
    id,
    name: id,
    componentId: 'root',
    kind: 'box',
    plane: { kind: 'named', name: 'XY', offset: 0 },
    origin: [x, 0],
    width: 10,
    depth: 10,
    height: 10,
    result: { kind: 'newBody', bodyId },
    ...patch,
  } as Feature
}

function boxDoc(name = 'Boxes', count = 1): OkcDocument {
  const doc = emptyDocument(name)
  for (let i = 0; i < count; i++) {
    doc.timeline.push(box(`box${i}`, `b${i}`, i * 20))
    doc.components[0].bodies.push({ id: `b${i}`, name: `Body${i}`, visible: true, colour: '#ccc' })
  }
  return doc
}

function cornerSketch(): Sketch2D {
  const sketch = emptySketch()
  sketch.points.push(
    { id: 'pa', x: 5, y: 5 },
    { id: 'pb', x: 25, y: 5 },
    { id: 'pc', x: 25, y: 20 },
  )
  sketch.entities.push(
    { id: 'l1', kind: 'line', p1: 'pa', p2: 'pb', construction: false },
    { id: 'l2', kind: 'line', p1: 'pb', p2: 'pc', construction: false },
  )
  sketch.constraints.push(
    { id: 'h1', kind: 'horizontal', e: 'l1' },
    { id: 'd1', kind: 'distance', a: 'pa', b: 'pb', value: 20 },
    { id: 'd2', kind: 'distance', a: 'pb', b: 'pc', value: 15 },
  )
  return sketch
}

function sound(sketch: Sketch2D): boolean {
  const points = new Set(sketch.points.map((p) => p.id))
  const entities = new Set(sketch.entities.map((e) => e.id))
  return (
    sketch.entities.every((e) => entityPointIds(e).every((id) => points.has(id))) &&
    sketch.constraints.every((c) =>
      constraintRefs(c).every((ref) => points.has(ref) || entities.has(ref)),
    )
  )
}

function board(id: string, name: string, width: number): CataloguePart {
  return {
    id,
    name,
    category: 'mcu',
    summary: 'A test board.',
    confidence: 'measured',
    source: 'Review test.',
    geometry: { kind: 'board', outline: { shape: 'rect', w: width, h: 20 }, thickness: 1.6 },
  }
}

function withParts(parts: unknown[]): OkcDocument {
  const doc = emptyDocument('Parts')
  parts.forEach((part, index) => {
    const partId = String((part as { id?: unknown }).id)
    doc.components.push({
      id: `part${index}`,
      name: String((part as { name?: unknown }).name),
      source: { kind: 'catalogue', partId },
      bodies: [],
    })
    doc.occurrences.push({
      id: `occ${index}`,
      parentComponentId: 'root',
      componentId: `part${index}`,
      name: `Part ${index}`,
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      visible: true,
      grounded: false,
    })
  })
  doc.customParts = parts as CataloguePart[]
  return doc
}

function loftDoc(step: 'none' | 'move' | 'scale'): OkcDocument {
  const doc = emptyDocument('Loft')
  const fix = { id: 'c-origin', kind: 'fix' as const, p: 'origin', x: 0, y: 0 }
  const square = [
    [-5, -5],
    [5, -5],
    [5, 5],
    [-5, 5],
  ]
  doc.timeline.push(
    {
      id: 'ska',
      kind: 'sketch',
      name: 'Circle',
      componentId: 'root',
      plane: { kind: 'named', name: 'XY', offset: 0 },
      visible: false,
      sketch: {
        points: [
          { id: 'origin', x: 0, y: 0 },
          { id: 'pc', x: 0, y: 0 },
        ],
        entities: [{ id: 'c1', kind: 'circle', c: 'pc', r: 10, construction: false }],
        constraints: [fix],
      },
    },
    {
      id: 'skb',
      kind: 'sketch',
      name: 'Square',
      componentId: 'root',
      plane: { kind: 'named', name: 'XY', offset: 30 },
      visible: false,
      sketch: {
        points: [
          { id: 'origin', x: 0, y: 0 },
          ...square.map(([x, y], i) => ({ id: `q${i}`, x, y })),
        ],
        entities: square.map((_, i) => ({
          id: `e${i}`,
          kind: 'line' as const,
          p1: `q${i}`,
          p2: `q${(i + 1) % 4}`,
          construction: false,
        })),
        constraints: [fix],
      },
    },
    {
      id: 'loft',
      kind: 'loft',
      name: 'Loft',
      componentId: 'root',
      sections: [{ sketchId: 'ska' }, { sketchId: 'skb' }],
      ruled: false,
      surface: false,
      result: { kind: 'newBody', bodyId: 'b1' },
    },
  )
  doc.components[0].bodies.push({ id: 'b1', name: 'Body1', visible: true, colour: '#ccc' })
  if (step === 'move') {
    doc.timeline.push({
      id: 'mv',
      kind: 'move',
      name: 'Move',
      componentId: 'root',
      bodyIds: ['b1'],
      offset: [0, 0, 0],
      rotation: [0, 0, 90],
    })
  }
  if (step === 'scale') {
    doc.timeline.push({
      id: 'sc',
      kind: 'scale',
      name: 'Scale',
      componentId: 'root',
      bodyIds: ['b1'],
      factor: 2,
    })
  }
  return doc
}

function bodyBounds(result: EvaluateResult, bodyId: string): number[] | null {
  const instance = result.instances.find((candidate) => candidate.bodyId === bodyId)
  const mesh = result.meshes.find((candidate) => candidate.key === instance?.meshKey)
  if (!mesh) return null
  const v = mesh.mesh.vertices
  const out = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (let i = 0; i < v.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      out[k] = Math.min(out[k], v[i + k])
      out[k + 3] = Math.max(out[k + 3], v[i + k])
    }
  }
  return out
}

function freshKernel(): { api: Comlink.Remote<KernelApi>; worker: Worker } {
  const worker = new Worker(new URL('../kernel/worker.ts', import.meta.url), { type: 'module' })
  return { api: Comlink.wrap<KernelApi>(worker), worker }
}

function Thrower(): never {
  throw new Error('Test crash in a panel')
}

export async function runReviewTest(): Promise<TestResult[]> {
  const out: TestResult[] = []
  const add = (name: string, pass: boolean, detail: string) =>
    out.push({ name: `Review fixes: ${name}`, pass, detail })
  const check = async (name: string, run: () => Promise<void> | void) => {
    try {
      await run()
    } catch (error) {
      add(name, false, `threw: ${(error as Error)?.stack ?? error}`)
    }
  }
  const saved = useStore.getState()
  const quiet = (doc: OkcDocument, extra: Record<string, unknown> = {}) =>
    useStore.setState({
      rebuild: () => {},
      doc,
      past: [],
      future: [],
      selection: { kind: 'none' },
      activeSketch: null,
      activeComponentId: doc.rootComponentId,
      subSelection: [],
      sketchSelection: [],
      meshes: new Map(),
      instances: [],
      commandOpen: false,
      transientBase: null,
      statusMessage: null,
      ...extra,
    })

  try {
    await check('sketch point delete', () => {
      const sketch = cornerSketch()
      deleteSketchItems(sketch, { points: ['pc'] })
      let regions = 'ok'
      try {
        sketchRegions(sketch)
      } catch (error) {
        regions = String(error)
      }
      add(
        "deleting a line's corner deletes the lines through it, and the sketch stays whole",
        sound(sketch) &&
          regions === 'ok' &&
          sketch.entities.map((e) => e.id).join() === 'l1' &&
          !sketch.points.some((p) => p.id === 'pc') &&
          !sketch.constraints.some((c) => c.id === 'd2') &&
          sketch.constraints.some((c) => c.id === 'd1'),
        `entities ${sketch.entities.map((e) => e.id).join()}, points ${sketch.points.map((p) => p.id).join()}, constraints ${sketch.constraints.map((c) => c.id).join()}, regions ${regions}`,
      )
    })

    await check('sketch line delete', () => {
      const sketch = cornerSketch()
      deleteSketchItems(sketch, { entities: ['l1'] })
      const tools = cornerSketch()
      deleteGeometry(tools, ['l1'])
      add(
        'deleting a line takes its lone endpoint and its dimensions with it, in both delete paths',
        sound(sketch) &&
          !sketch.points.some((p) => p.id === 'pa') &&
          sketch.points.some((p) => p.id === 'pb') &&
          !sketch.constraints.some((c) => c.id === 'd1' || c.id === 'h1') &&
          sketch.constraints.some((c) => c.id === 'd2') &&
          JSON.stringify(tools) === JSON.stringify(sketch),
        `points ${sketch.points.map((p) => p.id).join()}, constraints ${sketch.constraints.map((c) => c.id).join()}`,
      )
    })

    await check('shared corner and origin', () => {
      const sketch = cornerSketch()
      deleteSketchItems(sketch, { points: ['pb', 'origin'] })
      add(
        'a shared corner takes both lines, and the sketch origin cannot be deleted',
        sound(sketch) &&
          sketch.entities.length === 0 &&
          sketch.points.map((p) => p.id).join() === 'origin' &&
          sketch.constraints.map((c) => c.id).join() === 'c-origin',
        `points ${sketch.points.map((p) => p.id).join()}, constraints ${sketch.constraints.map((c) => c.id).join()}`,
      )
    })

    await check('store point delete', () => {
      const doc = emptyDocument('Sketch')
      doc.timeline.push({
        id: 'sk',
        kind: 'sketch',
        name: 'Sketch',
        componentId: 'root',
        plane: { kind: 'named', name: 'XY', offset: 0 },
        visible: true,
        sketch: cornerSketch(),
      })
      quiet(doc, { activeSketch: { featureId: 'sk', componentId: 'root' } })
      useStore.getState().applySketchAction({ kind: 'deletePoint', pointId: 'pc' })
      const after = useStore.getState().doc.timeline[0]
      const sketch = after.kind === 'sketch' ? after.sketch : emptySketch()
      add(
        'Delete on a corner in an open sketch leaves a sound sketch, in one undo step',
        sound(sketch) &&
          !sketch.entities.some((e) => e.id === 'l2') &&
          useStore.getState().past.length === 1,
        `entities ${sketch.entities.map((e) => e.id).join()}, undo steps ${useStore.getState().past.length}`,
      )
    })

    await check('undo while a command is open', () => {
      quiet(boxDoc('Undo', 1))
      useStore.getState().updateFeature('box0', { height: 20 })
      startCommand('box')
      const open = useStore.getState().commandOpen
      useStore.getState().undo()
      const held = (useStore.getState().doc.timeline[0] as { height: number }).height
      useCommand.getState().cancel()
      const closed = !useStore.getState().commandOpen
      useStore.getState().undo()
      const undone = (useStore.getState().doc.timeline[0] as { height: number }).height
      add(
        'undo waits while a command panel is open, and works again once it closes',
        open && held === 20 && closed && undone === 10,
        `open ${open}, height while open ${held}, closed ${closed}, after undo ${undone}`,
      )
    })

    await check('fast commits share structure', () => {
      const doc = boxDoc('Share', 3)
      doc.parameters = [{ id: 'p', name: 'w', value: 15, expression: '15' }]
      doc.bindings = [{ featureId: 'box0', field: 'width', expression: 'w' }]
      quiet(doc)
      useStore.getState().commit(() => {})
      const before = useStore.getState().doc
      useStore.getState().updateFeature('box1', { height: 12 })
      const after = useStore.getState().doc
      const previous = useStore.getState().past.at(-1)!
      add(
        'editing one step copies only that step, keeps the rest shared and leaves history alone',
        after.timeline[0] === before.timeline[0] &&
          after.timeline[2] === before.timeline[2] &&
          (after.timeline[1] as { height: number }).height === 12 &&
          (previous.timeline[1] as { height: number }).height === 10 &&
          (after.timeline[0] as { width: number }).width === 15 &&
          after.bindings.length === 1,
        `shared ${after.timeline[0] === before.timeline[0]}/${after.timeline[2] === before.timeline[2]}, history height ${(previous.timeline[1] as { height: number }).height}`,
      )
    })

    await check('fast sketch edits', () => {
      const doc = boxDoc('Sketch share', 1)
      doc.timeline.push({
        id: 'sk',
        kind: 'sketch',
        name: 'Sketch',
        componentId: 'root',
        plane: { kind: 'named', name: 'XY', offset: 0 },
        visible: true,
        sketch: cornerSketch(),
      })
      quiet(doc, { activeSketch: { featureId: 'sk', componentId: 'root' } })
      const before = useStore.getState().doc
      useStore.getState().editSketch((sketch) => {
        sketch.points.push({ id: 'pd', x: 40, y: 40 })
      })
      const after = useStore.getState().doc
      const old = before.timeline[1].kind === 'sketch' ? before.timeline[1].sketch : null
      const now = after.timeline[1].kind === 'sketch' ? after.timeline[1].sketch : null
      add(
        'a sketch edit copies only that sketch',
        after.timeline[0] === before.timeline[0] &&
          !!old &&
          !!now &&
          !old.points.some((p) => p.id === 'pd') &&
          now.points.some((p) => p.id === 'pd'),
        `box shared ${after.timeline[0] === before.timeline[0]}`,
      )
    })

    await check('move up one place', () => {
      const doc = boxDoc('Order', 1)
      doc.timeline.push(
        {
          id: 'fil',
          kind: 'fillet',
          name: 'Fillet',
          componentId: 'root',
          bodyId: 'b0',
          radius: 1,
          edges: [],
        },
        box('other', 'b9', 40),
      )
      add(
        'a step can move up past its neighbor only when it does not depend on it',
        !canMoveEarlier(doc, 0) && !canMoveEarlier(doc, 1) && canMoveEarlier(doc, 2),
        `${canMoveEarlier(doc, 0)} ${canMoveEarlier(doc, 1)} ${canMoveEarlier(doc, 2)}`,
      )
    })

    await check('restore after a bad link', () =>
      keepingStorage([AUTOSAVE, SET_ASIDE, USER_PARTS], async () => {
        const kept = boxDoc('Kept', 1)
        localStorage.setItem(AUTOSAVE, JSON.stringify({ savedAt: 'now', doc: kept }))
        const bad = boxDoc('Bad link', 1)
        bad.parameters = [{ id: 'p', name: 'Width', value: 10 }]
        const hash = `#${makeShareLink(bad).split('#')[1]}`
        quiet(emptyDocument())
        const notes = await restoreDesign(hash, () => true)
        const stored = JSON.parse(localStorage.getItem(AUTOSAVE) ?? '{}')
        add(
          'a link that cannot be opened says so and leaves the saved design open and untouched',
          useStore.getState().doc.name === 'Kept' &&
            notes.some((note) => note.includes('could not be opened')) &&
            stored?.doc?.name === 'Kept',
          `open ${useStore.getState().doc.name}, notes ${notes.join(' | ')}`,
        )
      }),
    )

    await check('restore after a bad autosave', () =>
      keepingStorage([AUTOSAVE, SET_ASIDE, USER_PARTS], async () => {
        const broken = boxDoc('Broken', 1)
        broken.parameters = [{ id: 'p', name: 'Width', value: 10 }]
        localStorage.setItem(AUTOSAVE, JSON.stringify({ savedAt: 'now', doc: broken }))
        localStorage.removeItem(SET_ASIDE)
        quiet(emptyDocument())
        const notes = await restoreDesign('', () => true)
        const aside = JSON.parse(localStorage.getItem(SET_ASIDE) ?? '{}')
        add(
          'a saved design that cannot be opened is kept aside, not overwritten',
          aside?.doc?.name === 'Broken' && notes.some((note) => note.includes('kept aside')),
          `aside ${aside?.doc?.name}, notes ${notes.join(' | ')}`,
        )
      }),
    )

    await check('link over unsaved work', () =>
      keepingStorage([AUTOSAVE, SET_ASIDE, USER_PARTS], async () => {
        localStorage.setItem(AUTOSAVE, JSON.stringify({ savedAt: 'now', doc: boxDoc('Mine', 1) }))
        const hash = `#${makeShareLink(boxDoc('Theirs', 2)).split('#')[1]}`
        quiet(emptyDocument())
        await restoreDesign(hash, () => false)
        const declined = useStore.getState().doc.name
        quiet(emptyDocument())
        await restoreDesign(hash, () => true)
        const accepted = useStore.getState().doc.name
        add(
          'a shared link asks before it replaces the design in progress',
          declined === 'Mine' && accepted === 'Theirs',
          `declined ${declined}, accepted ${accepted}`,
        )
      }),
    )

    await check('meshes live in IndexedDB', () =>
      keepingStorage([AUTOSAVE], async () => {
        const mesh = createMesh(
          [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10, Math.random(), 1, 1],
          [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3, 1, 4, 2],
        )
        const id = putMeshData(mesh)
        const stored = await until(() => isKept(id))
        const doc = emptyDocument('Mesh')
        doc.timeline.push({
          id: 'ins',
          kind: 'meshInsert',
          name: 'Scan',
          componentId: 'root',
          bodyId: 'mb',
          dataId: id,
          transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          unit: 'mm',
          yUp: false,
          centre: false,
          ground: false,
        })
        const wrote = saveAutosaveNow(doc)
        const parsed = JSON.parse(localStorage.getItem(AUTOSAVE) ?? '{}')
        const recalled = await recallMeshes([id])
        add(
          'autosave keeps imported meshes in IndexedDB instead of localStorage',
          stored &&
            wrote &&
            !parsed?.doc?.meshData &&
            recalled[id]?.positions === getMeshData(id)?.positions,
          `kept ${stored}, inline ${!!parsed?.doc?.meshData}, recalled ${!!recalled[id]}`,
        )
      }),
    )

    await check('autosave says when it fails', () =>
      keepingStorage([AUTOSAVE], async () => {
        const original = Storage.prototype.setItem
        Storage.prototype.setItem = function () {
          throw new DOMException('full', 'QuotaExceededError')
        }
        let now = true
        let later: boolean | 'never' = 'never'
        try {
          now = saveAutosaveNow(boxDoc('Full', 1))
          later = await Promise.race([
            new Promise<boolean>((resolve) => scheduleAutosave(boxDoc('Full', 1), resolve)),
            wait(3000).then(() => 'never' as const),
          ])
        } finally {
          Storage.prototype.setItem = original
        }
        add(
          'a full browser storage is reported instead of swallowed',
          now === false && later === false,
          `save now ${now}, scheduled ${later}`,
        )
      }),
    )

    await check('parts that arrive with a design', () =>
      keepingStorage([USER_PARTS], () => {
        localStorage.setItem(USER_PARTS, '[]')
        refreshUserParts()
        const first = withParts([board('odd-a', 'Odd A', 30), { id: 'broken', name: 'Broken' }])
        const r1 = adoptCustomParts(first)
        const clash = withParts([board('odd-a', 'Odd A', 40)])
        const r2 = adoptCustomParts(clash)
        const again = withParts([board('odd-a', 'Odd A', 40)])
        const r3 = adoptCustomParts(again)
        const same = withParts([board('odd-a', 'Odd A', 30)])
        const r4 = adoptCustomParts(same)
        const ids = userParts()
          .map((part) => part.id)
          .sort()
          .join()
        const partOf = (doc: OkcDocument) => {
          const source = doc.components[1].source
          return source.kind === 'catalogue' ? source.partId : ''
        }
        add(
          'broken parts are left out, a clashing part comes in as a copy, and nothing is copied twice',
          r1.added.join() === 'Odd A' &&
            r1.invalid[0]?.name === 'Broken' &&
            r2.copied.join() === 'Odd A' &&
            partOf(clash) === 'odd-a-2' &&
            r3.copied.length === 0 &&
            partOf(again) === 'odd-a-2' &&
            r4.copied.length + r4.added.length === 0 &&
            partOf(same) === 'odd-a' &&
            ids === 'odd-a,odd-a-2',
          `ids ${ids}, clash ${partOf(clash)}, again ${partOf(again)}, same ${partOf(same)}`,
        )
      }),
    )

    await check('stored parts are checked', () =>
      keepingStorage([USER_PARTS], () => {
        localStorage.setItem(
          USER_PARTS,
          JSON.stringify([board('good', 'Good', 30), { id: 'junk' }]),
        )
        refreshUserParts()
        const loaded = loadUserParts().map((part) => part.id)
        const saved = upsertUserPart(board('another', 'Another', 25))
        const raw = JSON.parse(localStorage.getItem(USER_PARTS) ?? '[]') as Array<{ id: string }>
        add(
          'a broken stored part is hidden from the app but not deleted from storage',
          loaded.join() === 'good' &&
            saved &&
            raw.map((part) => part.id).join() === 'good,junk,another',
          `loaded ${loaded.join()}, stored ${raw.map((part) => part.id).join()}`,
        )
      }),
    )

    await check('one bad part does not stop the build', async () => {
      const { api, worker } = freshKernel()
      try {
        const doc = withParts([
          { id: 'no-geometry', name: 'No geometry', category: 'mcu' },
          { id: 'nowhere', name: 'Nowhere' },
        ])
        doc.customParts = [{ id: 'no-geometry', name: 'No geometry', category: 'mcu' } as never]
        doc.timeline.push(box('box0', 'b0'))
        doc.components[0].bodies.push({ id: 'b0', name: 'Body', visible: true, colour: '#ccc' })
        const result = await api.evaluate(doc, [])
        add(
          'a broken or missing part fails on its own and the rest of the design still builds',
          result.instances.some((instance) => instance.bodyId === 'b0') &&
            result.errors.some(
              (e) => e.featureId === 'part0' && e.message.startsWith('Could not build'),
            ) &&
            result.errors.some(
              (e) => e.featureId === 'part1' && e.message.includes('not in the catalog'),
            ) &&
            !result.errors.some((e) => e.featureId === ''),
          result.errors.map((e) => `${e.featureId}: ${e.message}`).join(' | '),
        )
      } finally {
        worker.terminate()
      }
    })

    await check('move and scale about the true center', async () => {
      const warm = freshKernel()
      const cold = freshKernel()
      try {
        await warm.api.evaluate(loftDoc('none'), [])
        const warmMove = bodyBounds(await warm.api.evaluate(loftDoc('move'), []), 'b1')
        const coldMove = bodyBounds(await cold.api.evaluate(loftDoc('move'), []), 'b1')
        const scaled = bodyBounds(await cold.api.evaluate(loftDoc('scale'), []), 'b1')
        const same =
          !!warmMove &&
          !!coldMove &&
          warmMove.every((value, i) => Math.abs(value - coldMove[i]) < 1e-6)
        const centred = (b: number[] | null) =>
          !!b && Math.abs(b[0] + b[3]) < 0.02 && Math.abs(b[1] + b[4]) < 0.02
        add(
          'a rotated or scaled loft lands in the same place whether or not it was shown first',
          same &&
            centred(coldMove) &&
            centred(scaled) &&
            !!scaled &&
            Math.abs(scaled[2] + 15) < 1e-6 &&
            Math.abs(scaled[5] - 45) < 1e-6,
          `warm ${warmMove?.map((v) => v.toFixed(4)).join(',')} cold ${coldMove?.map((v) => v.toFixed(4)).join(',')} scaled ${scaled?.map((v) => v.toFixed(4)).join(',')}`,
        )
      } finally {
        warm.worker.terminate()
        cold.worker.terminate()
      }
    })

    await check('stop a stuck engine', async () => {
      await kernel().ready()
      void kernel()
        .debugSpin(30000)
        .catch(() => undefined)
      const stuck = requestBuild(boxDoc('Stuck', 1), [])
      await wait(400)
      const busy = !!useKernelActivity.getState().activity
      const stopped = stopKernel()
      const first = await Promise.race([stuck, wait(2000).then(() => null)])
      const second = await requestBuild(boxDoc('After', 1), [])
      add(
        'Stop ends a stuck build at once and the next build runs on a fresh engine',
        busy &&
          stopped?.kind === 'build' &&
          !!first?.errors[0]?.message.startsWith('Stopped after') &&
          second.instances.length === 1 &&
          second.errors.length === 0 &&
          !useKernelActivity.getState().activity,
        `busy ${busy}, stopped ${stopped?.kind}, first ${first?.errors[0]?.message}, second ${second.instances.length} shapes ${second.errors.map((e) => e.message).join()}`,
      )
    })

    await check('progress names the step', async () => {
      const doc = boxDoc('Progress', 1)
      doc.timeline.push(box('late', 'b7', 40))
      doc.components[0].bodies.push({ id: 'b7', name: 'Late', visible: true, colour: '#ccc' })
      const seen = new Set<string>()
      const unsubscribe = useKernelActivity.subscribe((state) => {
        if (state.activity?.step) seen.add(state.activity.step)
      })
      try {
        await requestBuild(doc, [])
      } finally {
        unsubscribe()
      }
      add(
        'the engine reports which step it is working on',
        seen.has('box0') || seen.has('late'),
        `steps seen ${[...seen].join(', ') || 'none'}`,
      )
    })

    await check('crash card', async () => {
      const host = document.createElement('div')
      document.body.appendChild(host)
      const root = createRoot(host)
      try {
        quiet(boxDoc('Crash', 1))
        flushSync(() =>
          root.render(
            <CrashGuard>
              <Thrower />
            </CrashGuard>,
          ),
        )
        await wait(50)
        const text = host.textContent ?? ''
        const undo = [...host.querySelectorAll('button')].find(
          (button) => button.textContent === 'Undo last change',
        )
        add(
          'a crash shows what broke with Undo and Reload instead of a blank page',
          text.includes('Something went wrong') &&
            text.includes('Test crash in a panel') &&
            !!undo?.disabled &&
            text.includes('Reload'),
          text,
        )
      } finally {
        root.unmount()
        host.remove()
      }
    })

    await check('viewport idles', async () => {
      const host = document.createElement('div')
      host.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:240px'
      document.body.appendChild(host)
      let engine: ViewportEngine
      try {
        engine = new ViewportEngine(host)
      } catch (error) {
        out.push({
          name: 'Review fixes: the viewport stops drawing when nothing changes',
          pass: true,
          skipped: true,
          detail: `no WebGL here: ${error}`,
        })
        host.remove()
        return
      }
      try {
        const info = (engine as unknown as { renderer: { info: { render: { frame: number } } } })
          .renderer.info.render
        await wait(400)
        const settled = info.frame
        await wait(600)
        const idle = info.frame - settled
        engine.resize()
        await until(() => info.frame > settled + idle, 3000)
        const woke = info.frame - settled - idle
        add(
          'the viewport stops drawing when nothing changes, and draws again when something does',
          idle === 0 && woke >= 1,
          `frames while idle ${idle}, after a change ${woke}`,
        )
      } finally {
        engine.dispose()
        host.remove()
      }
    })

    await check('3MF fan-out', () => {
      const objects = Array.from({ length: 25 }, (_, i) =>
        i < 24
          ? `<object id="${i + 1}" type="model"><components><component objectid="${i + 2}"/><component objectid="${i + 2}"/></components></object>`
          : `<object id="${i + 1}" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>`,
      ).join('')
      const model = `<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${objects}</resources><build><item objectid="1"/></build></model>`
      const bytes = zipSync({ '3D/3dmodel.model': strToU8(model) })
      const started = performance.now()
      let message = 'no error'
      try {
        parse3mf(bytes)
      } catch (error) {
        message = (error as Error).message
      }
      const seconds = (performance.now() - started) / 1000
      add(
        'a 3MF that nests components exponentially is refused quickly',
        message.includes('places more than') && seconds < 5,
        `${message} after ${seconds.toFixed(2)} s`,
      )
    })

    await check('dropped files', async () => {
      quiet(emptyDocument())
      const stl = writeStlBinary(
        createMesh([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10], [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
      )
      await openDroppedFile(new File([stl as BlobPart], 'tetra.stl'))
      const mesh = useCommand.getState().session?.spec.id
      useCommand.getState().cancel()
      await openDroppedFile(new File([serialise(boxDoc('Dropped', 1))], 'dropped.okc'))
      const opened = useStore.getState().doc.name
      await openDroppedFile(new File(['hello'], 'notes.txt'))
      const told = useStore.getState().statusMessage ?? ''
      add(
        'a dropped mesh opens Insert Mesh, a dropped design opens, anything else is explained',
        mesh === 'meshInsert' && opened === 'Dropped' && told.includes('.okc designs'),
        `mesh ${mesh}, opened ${opened}, status ${told}`,
      )
    })
  } finally {
    useCommand.getState().cancel()
    useStore.setState(saved, true)
  }
  return out
}
