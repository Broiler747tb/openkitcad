import { useStore } from '../doc/store'
import {
  emptyDocument,
  type BodyPatternFeature,
  type Feature,
  type LoftFeature,
  type MirrorFeature,
  type OkcDocument,
  type PlaneRef,
  type SweepFeature,
} from '../doc/types'
import { emptySketch, type Sketch2D } from '../sketch/types'
import { canEditInPanel, editFeature } from '../ui/command/commands'
import { useCommand } from '../ui/command/session'
import {
  coilCommand,
  extrudeSurfaceCommand,
  loftCommand,
  mirrorCommand,
  patternCommand,
  pipeCommand,
  scaleCommand,
  stitchCommand,
  sweepCommand,
  unstitchCommand,
} from '../ui/command/specs/create'
import { extrudeCommand } from '../ui/command/specs/sketchBased'
import { createCommandState, evaluateCommand } from '../ui/command/state'
import type {
  AnyCommandSpec,
  CommandContext,
  CommandInitialValues,
  SelectionPick,
} from '../ui/command/types'
import type { TestResult } from './selftest'

const XY: PlaneRef = { kind: 'named', name: 'XY', offset: 0 }

function rectangle(): Sketch2D {
  const sketch = emptySketch()
  const corners: Array<[number, number]> = [
    [0, 0],
    [20, 0],
    [20, 10],
    [0, 10],
  ]
  corners.forEach(([x, y], i) => sketch.points.push({ id: `p${i}`, x, y }))
  for (let i = 0; i < 4; i++) {
    sketch.entities.push({
      id: `l${i}`,
      kind: 'line',
      p1: `p${i}`,
      p2: `p${(i + 1) % 4}`,
      construction: false,
    })
  }
  return sketch
}

function circle(): Sketch2D {
  const sketch = emptySketch()
  sketch.points.push({ id: 'c', x: 10, y: 5 })
  sketch.entities.push({ id: 'k', kind: 'circle', c: 'c', r: 4, construction: false })
  return sketch
}

function polyline(points: Array<[number, number]>): Sketch2D {
  const sketch = emptySketch()
  points.forEach(([x, y], i) => sketch.points.push({ id: `q${i}`, x, y }))
  for (let i = 0; i + 1 < points.length; i++) {
    sketch.entities.push({
      id: `m${i}`,
      kind: 'line',
      p1: `q${i}`,
      p2: `q${i + 1}`,
      construction: false,
    })
  }
  return sketch
}

function testDocument(): OkcDocument {
  const doc = emptyDocument('Create commands')
  const sketch = (id: string, plane: PlaneRef, drawing: Sketch2D): Feature => ({
    id,
    kind: 'sketch',
    name: id,
    componentId: doc.rootComponentId,
    plane,
    sketch: drawing,
    visible: true,
  })
  doc.timeline.push(
    sketch('square', XY, rectangle()),
    sketch('round', { kind: 'named', name: 'XY', offset: 20 }, circle()),
    sketch(
      'path',
      { kind: 'named', name: 'XZ', offset: 0 },
      polyline([
        [0, 0],
        [0, 30],
        [20, 50],
      ]),
    ),
    sketch(
      'wave',
      XY,
      polyline([
        [0, 0],
        [10, 5],
        [20, 0],
      ]),
    ),
  )
  doc.components[0].bodies.push(
    { id: 'b1', name: 'One', visible: true, colour: '#cccccc' },
    { id: 'b2', name: 'Two', visible: true, colour: '#cccccc' },
  )
  return doc
}

const sketchPick = (id: string): SelectionPick => ({ kind: 'sketch', id, label: id })
const bodyPick = (id: string): SelectionPick => ({ kind: 'body', id, bodyId: id, label: id })

export function runCreateCommandTest(): TestResult[] {
  const results: TestResult[] = []
  let current = ''
  const check = (pass: boolean, detail: string) =>
    results.push({ name: `Create commands: ${current}`, pass, detail })
  const test = (name: string, body: () => void) => {
    current = name
    try {
      body()
    } catch (error) {
      check(false, `threw: ${(error as Error).stack ?? String(error)}`)
    }
  }
  const doc = testDocument()
  let serial = 0
  const contextFor = (editing?: Feature): CommandContext => ({
    doc,
    unit: doc.units,
    componentId: doc.rootComponentId,
    id: (role) => `${role}-${++serial}`,
    editing,
    editingFeatureId: editing?.id,
  })
  const evaluate = (spec: unknown, initial: CommandInitialValues, editing?: Feature) => {
    const command = spec as AnyCommandSpec
    const context = contextFor(editing)
    return evaluateCommand(command, createCommandState(command, context, initial), context, {
      build: true,
    })
  }

  test('loft keeps the order the profiles were picked in', () => {
    const result = evaluate(loftCommand, { sections: [sketchPick('round'), sketchPick('square')] })
    const loft = result.features?.[0] as LoftFeature | undefined
    check(
      loft?.kind === 'loft' &&
        loft.sections.map((section) => section.sketchId).join() === 'round,square' &&
        loft.result.kind === 'newBody' &&
        !loft.surface,
      JSON.stringify(loft ?? result.fieldErrors),
    )
  })

  test('loft refuses two profiles from one sketch', () => {
    const result = evaluate(loftCommand, {
      sections: [
        { kind: 'profile', id: 'square|a', label: 'a', profile: { sketchId: 'square', key: 'a' } },
        { kind: 'profile', id: 'square|b', label: 'b', profile: { sketchId: 'square', key: 'b' } },
      ],
    })
    check(!result.valid && !!result.fieldErrors.sections, JSON.stringify(result.fieldErrors))
  })

  test('a surface loft is always a new body, whatever operation was left set', () => {
    const result = evaluate(loftCommand, {
      sections: [sketchPick('square'), sketchPick('round')],
      surface: true,
      operation: 'join',
      bodies: [bodyPick('b1')],
    })
    const loft = result.features?.[0] as LoftFeature | undefined
    check(
      loft?.surface === true && loft.result.kind === 'newBody' && loft.name === 'Loft Surface',
      JSON.stringify(loft ?? result),
    )
  })

  test('sweep needs its path in another sketch', () => {
    const same = evaluate(sweepCommand, {
      profile: [sketchPick('square')],
      path: [sketchPick('square')],
    })
    check(!same.valid && !!same.fieldErrors.path, JSON.stringify(same.fieldErrors))
    const good = evaluate(sweepCommand, {
      profile: [sketchPick('round')],
      path: [sketchPick('path')],
    })
    const sweep = good.features?.[0] as SweepFeature | undefined
    check(
      sweep?.sketchId === 'round' && sweep.pathSketchId === 'path',
      JSON.stringify(sweep ?? good),
    )
  })

  test('an open sketch extrudes as a surface but not as a solid', () => {
    const solid = evaluate(extrudeCommand, { profile: [sketchPick('wave')] })
    check(!solid.valid, 'a solid extrude of open lines is refused')
    const surface = evaluate(extrudeCommand, {
      profile: [sketchPick('wave')],
      surface: true,
      operation: 'cut',
      bodies: [bodyPick('b1')],
    })
    const feature = surface.features?.[0]
    check(
      feature?.kind === 'extrude' && feature.surface === true && feature.result.kind === 'newBody',
      JSON.stringify(feature ?? surface),
    )
  })

  test('the Surface tab extrude starts as a surface', () => {
    const result = evaluate(extrudeSurfaceCommand, { profile: [sketchPick('wave')] })
    const feature = result.features?.[0]
    check(
      extrudeSurfaceCommand.id === 'extrudeSurface' &&
        feature?.kind === 'extrude' &&
        feature.surface === true &&
        feature.name === 'Extrude Surface',
      JSON.stringify(feature ?? result),
    )
  })

  test('a rectangular pattern makes a new body for every copy of every body', () => {
    const result = evaluate(patternCommand, {
      bodies: [bodyPick('b1'), bodyPick('b2')],
      countOne: 3,
      countTwo: 2,
    })
    const pattern = result.features?.[0] as BodyPatternFeature | undefined
    check(
      pattern?.newBodyIds.length === 10 && new Set(pattern.newBodyIds).size === 10,
      JSON.stringify(pattern ?? result),
    )
    const clash = evaluate(patternCommand, {
      bodies: [bodyPick('b1')],
      axisOne: 'x',
      axisTwo: 'x',
      countTwo: 2,
    })
    check(!clash.valid, 'both directions along X are refused')
  })

  test('editing a pattern keeps the bodies it already made', () => {
    const editing: BodyPatternFeature = {
      id: 'pattern',
      kind: 'bodyPattern',
      name: 'Pattern',
      componentId: doc.rootComponentId,
      bodyIds: ['b1'],
      pattern: 'circular',
      axisOne: 'x',
      countOne: 1,
      spacingOne: 10,
      axisTwo: 'y',
      countTwo: 1,
      spacingTwo: 10,
      axis: 'z',
      count: 3,
      angle: 360,
      newBodyIds: ['kept-1', 'kept-2'],
    }
    const result = evaluate(
      patternCommand,
      { bodies: [bodyPick('b1')], pattern: 'circular', count: 5 },
      editing,
    )
    const pattern = result.features?.[0] as BodyPatternFeature | undefined
    check(
      pattern?.id === 'pattern' &&
        pattern.newBodyIds.length === 4 &&
        pattern.newBodyIds[0] === 'kept-1' &&
        pattern.newBodyIds[1] === 'kept-2',
      JSON.stringify(pattern?.newBodyIds ?? result),
    )
  })

  test('mirror falls back to an origin plane with an offset', () => {
    const result = evaluate(mirrorCommand, { bodies: [bodyPick('b1')], origin: 'YZ', offset: 5 })
    const mirror = result.features?.[0] as MirrorFeature | undefined
    check(
      mirror?.plane.kind === 'named' &&
        mirror.plane.name === 'YZ' &&
        mirror.plane.offset === 5 &&
        mirror.newBodyIds.length === 1,
      JSON.stringify(mirror ?? result),
    )
  })

  test('coil and pipe refuse sections that do not fit', () => {
    const coil = evaluate(coilCommand, { diameter: 10, sectionSize: 12 })
    check(!!coil.fieldErrors.sectionSize, JSON.stringify(coil.fieldErrors))
    const pipe = evaluate(pipeCommand, {
      path: [sketchPick('path')],
      size: 4,
      hollow: true,
      thickness: 2,
    })
    check(!!pipe.fieldErrors.thickness, JSON.stringify(pipe.fieldErrors))
  })

  test('scale factors and coil revolutions are plain numbers in any unit', () => {
    const inches = { ...contextFor(), unit: 'in' as const }
    const command = scaleCommand as unknown as AnyCommandSpec
    const state = createCommandState(command, inches, { bodies: [bodyPick('b1')], factor: 2.5 })
    const field = state.fields.factor
    const built = evaluateCommand(command, state, inches, { build: true })
    const feature = built.features?.[0]
    check(
      field?.kind === 'number' &&
        field.text === '2.5' &&
        feature?.kind === 'scale' &&
        feature.factor === 2.5,
      `${JSON.stringify(field)} ${JSON.stringify(feature ?? built.fieldErrors)}`,
    )
    const coil = evaluate(coilCommand, { revolutions: 5.5 })
    const made = coil.features?.[0]
    check(made?.kind === 'coil' && made.revolutions === 5.5, JSON.stringify(made ?? coil))
  })

  test('stitch needs at least two surfaces', () => {
    const result = evaluate(stitchCommand, { bodies: [bodyPick('b1')] })
    check(!result.valid, `missing: ${result.missing.join()}`)
  })

  test('editing an unstitch keeps a body for every face it split off', () => {
    const editing: Feature = {
      id: 'unstitch',
      kind: 'unstitch',
      name: 'Unstitch',
      componentId: doc.rootComponentId,
      bodyId: 'b1',
      newBodyIds: ['f1', 'f2', 'f3', 'f4', 'f5'],
    }
    const result = evaluate(unstitchCommand, { body: [bodyPick('b1')] }, editing)
    const feature = result.features?.[0]
    check(
      feature?.kind === 'unstitch' && feature.newBodyIds.join() === 'f1,f2,f3,f4,f5',
      JSON.stringify(feature ?? result),
    )
  })

  test('every new step reopens in its panel with the values it was made with', () => {
    const saved = useStore.getState()
    const steps: Feature[] = [
      {
        id: 'loft1',
        kind: 'loft',
        name: 'Loft',
        componentId: 'root',
        sections: [{ sketchId: 'square' }, { sketchId: 'round' }],
        ruled: true,
        surface: false,
        result: { kind: 'newBody', bodyId: 'lofted' },
      },
      {
        id: 'sweep1',
        kind: 'sweep',
        name: 'Sweep Surface',
        componentId: 'root',
        sketchId: 'round',
        pathSketchId: 'path',
        surface: true,
        result: { kind: 'newBody', bodyId: 'swept' },
      },
      {
        id: 'coil1',
        kind: 'coil',
        name: 'Coil',
        componentId: 'root',
        plane: { kind: 'named', name: 'XZ', offset: 4 },
        centre: [3, 4],
        diameter: 30,
        revolutions: 7,
        height: 45,
        section: 'square',
        sectionSize: 3,
        clockwise: true,
        result: { kind: 'join', bodyId: 'b1' },
      },
      {
        id: 'pipe1',
        kind: 'pipe',
        name: 'Pipe',
        componentId: 'root',
        pathSketchId: 'path',
        section: 'triangular',
        size: 8,
        hollow: true,
        thickness: 1.5,
        result: { kind: 'cut', bodyIds: ['b1', 'b2'] },
      },
      {
        id: 'thicken1',
        kind: 'thicken',
        name: 'Thicken',
        componentId: 'root',
        sourceBodyId: 'b2',
        thickness: 3,
        symmetric: true,
        result: { kind: 'newBody', bodyId: 'thick' },
      },
      {
        id: 'patch1',
        kind: 'patch',
        name: 'Patch',
        componentId: 'root',
        sketchId: 'square',
        bodyId: 'patched',
      },
      {
        id: 'mirror1',
        kind: 'mirror',
        name: 'Mirror',
        componentId: 'root',
        bodyIds: ['b1', 'b2'],
        plane: { kind: 'named', name: 'XZ', offset: -2 },
        newBodyIds: ['m1', 'm2'],
      },
      {
        id: 'split1',
        kind: 'splitBody',
        name: 'Split Body',
        componentId: 'root',
        bodyId: 'b1',
        plane: { kind: 'named', name: 'YZ', offset: 10 },
        newBodyId: 'half',
      },
      {
        id: 'scale1',
        kind: 'scale',
        name: 'Scale',
        componentId: 'root',
        bodyIds: ['b1'],
        factor: 2.5,
      },
      {
        id: 'stitch1',
        kind: 'stitch',
        name: 'Stitch',
        componentId: 'root',
        bodyIds: ['b1', 'b2'],
        tolerance: 0.05,
      },
      {
        id: 'offset1',
        kind: 'surfaceOffset',
        name: 'Offset Surface',
        componentId: 'root',
        sourceBodyId: 'b1',
        distance: -4,
        bodyId: 'shifted',
      },
      {
        id: 'reverse1',
        kind: 'reverseNormal',
        name: 'Reverse Normal',
        componentId: 'root',
        bodyIds: ['b1', 'b2'],
      },
      {
        id: 'extrude1',
        kind: 'extrude',
        name: 'Extrude Surface',
        componentId: 'root',
        sketchId: 'wave',
        distance: 12,
        symmetric: false,
        reverse: true,
        surface: true,
        result: { kind: 'newBody', bodyId: 'wall' },
      },
    ]
    try {
      const document = testDocument()
      useStore.setState({ doc: document, activeSketch: null })
      for (const step of steps) {
        current = `${step.kind} reopens with its values`
        if (!canEditInPanel(step) || !editFeature(step)) {
          check(false, 'it has no panel')
          continue
        }
        const session = useCommand.getState().session!
        const built = evaluateCommand(session.spec, session.state, session.context, {
          build: true,
        })
        const again = built.features?.[0]
        check(
          JSON.stringify(again) === JSON.stringify(step),
          `${JSON.stringify(again ?? { errors: built.fieldErrors, form: built.formError })} vs ${JSON.stringify(step)}`,
        )
        useCommand.getState().cancel()
      }
    } finally {
      useStore.setState(saved)
    }
  })

  return results
}
