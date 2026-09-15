import {
  activeComponentOf,
  bodyBounds,
  componentInstance,
  newId,
  occurrencePathOf,
  targetBodies,
  useStore,
  type Selection,
} from '../doc/store'
import type {
  Body,
  ExtrudeFeature,
  Feature,
  MoveFeature,
  OkcDocument,
  LidFit,
  SketchFeature,
  VentShape,
} from '../doc/types'
import {
  activeFeatures,
  bodyCreator,
  featureCreatesBodies,
  featureModifiesBodies,
  findBody,
  findComponent,
  findFeature,
  findOccurrence,
} from '../doc/model'
import { poseOf, withPose } from '../doc/placement'
import { resizeSketch } from '../sketch/edit'
import { getPart } from '../catalogue'
import { ContextMenu } from './ContextMenu'
import { chooseAction } from './ActionDialog'

interface PromptField {
  label: string
  initial: number
  unit: string
  min?: number
  max?: number
}

export interface ObjectAction {
  id: string
  label: string
  /** Heading this sits under. Derived from the id, see objectGroupOf. */
  group?: string
  hint?: string
  prompt?: PromptField
  /** A second number, for the few things that genuinely need two. */
  prompt2?: PromptField
  /** And a third, for setting all of a box's sides at once. */
  prompt3?: PromptField
  /** Sub-section within the group, for menus deep enough to need one. */
  sub?: string
  /** A pick-one field, for the few choices that are not a number. */
  choice?: {
    label: string
    initial: string
    options: Array<{ value: string; label: string; hint?: string }>
  }
  danger?: boolean
  run: (value: number, value2?: number, value3?: number, choice?: string) => void
}

const OBJECT_GROUPS: Array<[string, string[]]> = [
  ['Start a sketch', ['sketch-XY', 'sketch-XZ', 'sketch-YZ', 'sketch-offset', 'sketch-tilted']],
  ['Add a shape', ['add-box', 'add-cylinder', 'add-sphere', 'add-dome']],
  ['Assemble', ['create-component', 'linked-copy', 'activate']],
  ['Draw on it', ['sketch-on-face', 'sketch-on-top', 'edit-sketch']],
  [
    'Change its shape',
    ['size', 'hollow', 'hollow-lid', 'round-picked', 'bevel-picked', 'round', 'bevel'],
  ],
  [
    'Cut into it',
    [
      'vent-hex',
      'vent-round',
      'vent-square',
      'vent-triangle',
      'vent-diamond',
      'vent-slot',
      'vent-cross',
      'vent-gyroid',
      'cut-ball',
      'cut-box',
    ],
  ],
  ['Move it', ['move', 'turn', 'flip']],
  ['Build around it', ['holes', 'standoffs', 'ports']],
  ['This part', ['negative', 'hide', 'delete']],
]

export function objectGroupOf(id: string): string {
  if (id.startsWith('join-') || id.startsWith('cut-') || id.startsWith('overlap-')) {
    // Careful: "cut-ball" and "cut-box" are shapes, not other bodies.
    if (id !== 'cut-ball' && id !== 'cut-box') return 'Combine with another part'
  }
  for (const [group, ids] of OBJECT_GROUPS) {
    if (ids.includes(id)) return group
  }
  return 'Other'
}

export function trailingMove(doc: OkcDocument, bodyId: string): MoveFeature | undefined {
  const touching = activeFeatures(doc).filter(
    (feature) =>
      featureCreatesBodies(feature).includes(bodyId) ||
      featureModifiesBodies(feature).includes(bodyId),
  )
  const last = touching[touching.length - 1]
  return last?.kind === 'move' && last.bodyIds.length === 1 ? last : undefined
}

function ensureMove(bodyId: string): void {
  const store = useStore.getState()
  if (trailingMove(store.doc, bodyId)) return
  const componentId = findBody(store.doc, bodyId)?.component.id
  if (!componentId) return
  store.addFeature({
    id: newId('move'),
    kind: 'move',
    name: 'Move',
    componentId,
    bodyIds: [bodyId],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
  })
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** How far a drawn outline reaches, which is what its width and length mean. */
function sketchExtent(sketch: SketchFeature['sketch']): { width: number; height: number } | null {
  if (sketch.points.length === 0) return null
  const xs = sketch.points.map((p) => p.x)
  const ys = sketch.points.map((p) => p.y)
  const width = Math.max(...xs) - Math.min(...xs)
  const height = Math.max(...ys) - Math.min(...ys)
  // A sketch with no extent one way cannot be scaled by a ratio.
  if (width < 1e-6 || height < 1e-6) return null
  return { width, height }
}

function mainExtrude(doc: OkcDocument, bodyId: string): ExtrudeFeature | undefined {
  const creator = bodyCreator(doc, bodyId)
  if (creator?.kind === 'extrude') return creator
  return doc.timeline.find(
    (f): f is ExtrudeFeature => f.kind === 'extrude' && featureModifiesBodies(f).includes(bodyId),
  )
}

export interface PickedFace {
  bodyId: string
  instanceId: string
  point: [number, number, number]
  normal: [number, number, number]
}

export const OBJECT_GROUP_ORDER = [
  ...OBJECT_GROUPS.map(([name]) => name),
  'Combine with another part',
]

export function objectActions(
  selection: Selection,
  picked?: PickedFace | null,
  targetBodyId?: string,
): ObjectAction[] {
  return buildObjectActions(selection, picked, targetBodyId).map((a) => ({
    ...a,
    group: objectGroupOf(a.id),
    ...(a.id.startsWith('add-')
      ? {
          run: (v: number, v2?: number, v3?: number, choice?: string) => {
            a.run(v, v2, v3, choice)
            window.dispatchEvent(new CustomEvent('okc:fit'))
          },
        }
      : {}),
    ...(['holes', 'standoffs', 'ports'].includes(a.id)
      ? {
          choice: {
            label: 'Target body',
            initial: targetBodyId ?? targetBodies(useStore.getState().doc)[0]?.value ?? '',
            options: targetBodies(useStore.getState().doc),
          },
          run: (v: number, v2?: number, v3?: number, target?: string) => {
            buildObjectActions(selection, picked, target)
              .find((item) => item.id === a.id)
              ?.run(v, v2, v3)
          },
        }
      : {}),
  }))
}

function addPrimitive(name: string, build: (componentId: string, bodyId: string) => Feature) {
  const store = useStore.getState()
  const componentId = activeComponentOf(store)
  const bodyId = newId('body')
  store.addFeature(build(componentId, bodyId), { [bodyId]: { name } })
  useStore.getState().select({ kind: 'body', id: bodyId })
}

export function mountFeature(
  kind: 'holes' | 'standoffs' | 'ports',
  occurrenceId: string,
  targetBodyId: string,
  options: { height?: number; instanceId?: string } = {},
): Feature | null {
  const state = useStore.getState()
  const doc = state.doc
  const occurrence = findOccurrence(doc, occurrenceId)
  const component = occurrence ? findComponent(doc, occurrence.componentId) : undefined
  const target = findBody(doc, targetBodyId)
  if (!occurrence || component?.source.kind !== 'catalogue' || !target) return null
  const part = getPart(component.source.partId)
  const occurrencePath = occurrencePathOf(doc, occurrenceId, options.instanceId)
  if (!occurrencePath) return null
  const contextPath = componentInstance(doc, target.component.id)?.path ?? []
  const drillZ = bodyBounds(state, targetBodyId)?.[5] ?? poseOf(occurrence.transform).position[2]
  const hole = part?.mountingHoles?.[0]
  if (kind === 'holes') {
    return {
      id: newId('hole'),
      kind: 'hole',
      name: `Holes for ${occurrence.name}`,
      componentId: target.component.id,
      bodyId: targetBodyId,
      plane: { kind: 'named', name: 'XY', offset: drillZ },
      source: { kind: 'occurrence', occurrencePath, contextPath },
      style: 'counterbore',
      diameter: (hole?.diameter ?? 3) + 0.2,
      depth: 'through',
      counterboreDiameter: (hole?.diameter ?? 3) + 3,
      counterboreDepth: 2,
    }
  }
  if (kind === 'standoffs') {
    const height = options.height ?? 6
    return {
      id: newId('standoff'),
      kind: 'standoff',
      name: `Standoffs for ${occurrence.name}`,
      componentId: target.component.id,
      plane: { kind: 'named', name: 'XY', offset: drillZ },
      source: { kind: 'occurrence', occurrencePath, contextPath },
      height,
      outerDiameter: (hole?.diameter ?? 3) + 3,
      boreDiameter: Math.max((hole?.diameter ?? 3) - 0.6, 1.2),
      boreDepth: Math.max(height - 1, 2),
      result: { kind: 'join', bodyId: targetBodyId },
    }
  }
  return {
    id: newId('ports'),
    kind: 'portCutout',
    name: `Openings for ${occurrence.name}`,
    componentId: target.component.id,
    bodyId: targetBodyId,
    occurrencePath,
    contextPath,
    connectorIds: [],
    tolerance: 0.6,
  }
}

function buildObjectActions(
  selection: Selection,
  picked?: PickedFace | null,
  targetBodyId?: string,
): ObjectAction[] {
  const store = useStore.getState()
  const doc = store.doc
  const raw: ObjectAction[] = []
  const out = raw

  if (selection.kind === 'body' && selection.id) {
    const bodyId = selection.id
    const found = findBody(doc, bodyId)
    if (!found) return raw
    const { body, component } = found
    const componentId = component.id
    const extrude = mainExtrude(doc, bodyId)
    const sketchId = extrude?.sketchId
    const onThis = !!picked && picked.bodyId === bodyId

    if (picked && onThis) {
      out.push({
        id: 'sketch-on-face',
        label: 'Draw on this face',
        hint: 'Start an outline right where you clicked',
        run: () =>
          store.startSketch(
            {
              kind: 'face',
              face: { bodyId, anchor: picked.point, normal: picked.normal },
              offset: 0,
            },
            bodyId,
          ),
      })
    }

    if (sketchId && findFeature(doc, sketchId)?.kind === 'sketch') {
      out.push({
        id: 'edit-sketch',
        label: 'Edit the shape this was drawn from',
        hint: 'Go back to the outline and change it',
        run: () => store.openSketch(sketchId),
      })
    }
    const creator = bodyCreator(doc, bodyId)
    const solid = creator?.kind === 'box' || creator?.kind === 'cylinder' ? creator : undefined
    if (solid?.kind === 'box') {
      out.push({
        id: 'size',
        label: 'Change its size',
        hint: 'Width, depth and height',
        prompt: { label: 'Width', initial: solid.width, unit: 'mm' },
        prompt2: { label: 'Depth', initial: solid.depth, unit: 'mm' },
        prompt3: { label: 'Height', initial: solid.height, unit: 'mm' },
        run: (width, depth, height) =>
          store.updateFeature(solid.id, {
            width,
            depth: depth ?? solid.depth,
            height: height ?? solid.height,
          } as Partial<Feature>),
      })
    } else if (solid?.kind === 'cylinder') {
      out.push({
        id: 'size',
        label: 'Change its size',
        hint: 'Across and tall',
        prompt: { label: 'Diameter', initial: solid.radius * 2, unit: 'mm' },
        prompt2: { label: 'Height', initial: solid.height, unit: 'mm' },
        run: (diameter, height) =>
          store.updateFeature(solid.id, {
            radius: diameter / 2,
            height: height ?? solid.height,
          } as Partial<Feature>),
      })
    } else if (extrude) {
      const source = findFeature(doc, extrude.sketchId)
      const drawn = source?.kind === 'sketch' ? source : undefined
      const box = drawn ? sketchExtent(drawn.sketch) : null
      out.push({
        id: 'size',
        label: 'Change its size',
        hint: box ? 'Across, front to back, and thick' : 'How thick it is',
        prompt: box
          ? { label: 'Width', initial: round1(box.width), unit: 'mm' }
          : { label: 'Thickness', initial: extrude.distance, unit: 'mm' },
        prompt2: box ? { label: 'Length', initial: round1(box.height), unit: 'mm' } : undefined,
        prompt3: box ? { label: 'Thickness', initial: extrude.distance, unit: 'mm' } : undefined,
        run: (a, b, c) => {
          if (!box || !drawn) {
            store.updateFeature(extrude.id, { distance: a } as Partial<Feature>)
            return
          }
          const thickness = c ?? extrude.distance
          const resized = resizeSketch(drawn.sketch, a / box.width, (b ?? box.height) / box.height)
          if (!resized.ok) {
            store.setStatus(resized.reason)
            store.updateFeature(extrude.id, { distance: thickness } as Partial<Feature>)
            return
          }
          store.updateFeature(drawn.id, { sketch: resized.sketch } as Partial<Feature>)
          store.updateFeature(extrude.id, { distance: thickness } as Partial<Feature>)
        },
      })
    }
    if (picked && onThis) {
      const hollowOut = (
        thickness: number,
        withLid: boolean,
        clearance = 0,
        fit: LidFit = 'friction',
      ) => {
        const shellId = newId('shell')
        const features: Feature[] = [
          {
            id: shellId,
            kind: 'shell',
            name: 'Hollow out',
            componentId,
            bodyId,
            thickness,
            openFaces: [{ bodyId, anchor: picked.point, normal: picked.normal }],
          },
        ]
        const bodies: Record<string, Partial<Body>> = {}
        if (withLid) {
          const lidBodyId = newId('body')
          const lidId = newId('lid')
          bodies[lidBodyId] = { name: `${body.name} lid` }
          features.push({
            id: lidId,
            kind: 'lid',
            name: 'Lid',
            componentId,
            sourceBodyId: bodyId,
            shellFeatureId: shellId,
            thickness,
            clearance,
            fit,
            result: { kind: 'newBody', bodyId: lidBodyId },
          })
          if (fit !== 'friction') {
            features.push({
              id: newId('seat'),
              kind: 'lidSocket',
              name: fit === 'ledge' ? 'Ledge for the lid' : 'Groove for the lid',
              componentId,
              bodyId,
              lidFeatureId: lidId,
            })
          }
        }
        store.addFeatures(features, bodies)
      }

      out.push({
        id: 'hollow',
        label: 'Hollow it out, opening this face',
        hint: 'Turns a solid block into a box with walls this thick',
        prompt: { label: 'Wall', initial: 2, unit: 'mm' },
        run: (thickness) => hollowOut(thickness, false),
      })
      out.push({
        id: 'hollow-lid',
        label: 'Hollow it out and make this side a lid',
        hint: 'Same, plus a cap that drops into the opening',
        choice: {
          label: 'How it holds on',
          initial: 'ledge',
          options: [
            {
              value: 'ledge',
              label: 'Rests on a ledge',
              hint: 'A step is cut into the wall so the lid sits on it and cannot fall through. Good default.',
            },
            {
              value: 'snap',
              label: 'Snaps in',
              hint: 'The lid gets a thin skirt with a ridge round it that clicks into a groove in the wall. Needs a wall of about 2 mm or more.',
            },
            {
              value: 'friction',
              label: 'Just drops in',
              hint: 'Nothing holds it but the fit. Simplest to print, and it lifts straight out.',
            },
          ],
        },
        prompt: { label: 'Wall', initial: 2, unit: 'mm' },
        prompt2: { label: 'Gap round the lid', initial: 0.2, unit: 'mm' },
        run: (thickness, clearance, _third, fit) =>
          hollowOut(thickness, true, clearance ?? 0.2, (fit as LidFit) ?? 'ledge'),
      })
    }
    const pickedEdges = store.subSelection.filter((s) => s.bodyId === bodyId && s.kind === 'edge')
    if (pickedEdges.length > 0) {
      const refs = pickedEdges.map((s) => ({
        bodyId,
        anchor: s.point,
        length: s.length ?? 0,
      }))
      const many = pickedEdges.length > 1
      out.push({
        id: 'round-picked',
        label: `Round ${many ? `these ${pickedEdges.length} edges` : 'this edge'}`,
        hint: 'Only the ones you selected',
        prompt: { label: 'Radius', initial: 2, unit: 'mm' },
        run: (radius) =>
          store.addFeature({
            id: newId('fillet'),
            kind: 'fillet',
            name: many ? `Round ${pickedEdges.length} edges` : 'Round an edge',
            componentId,
            bodyId,
            radius,
            edges: refs,
          }),
      })
      out.push({
        id: 'bevel-picked',
        label: `Bevel ${many ? `these ${pickedEdges.length} edges` : 'this edge'}`,
        prompt: { label: 'Size', initial: 1, unit: 'mm' },
        run: (distance) =>
          store.addFeature({
            id: newId('chamfer'),
            kind: 'chamfer',
            name: many ? `Bevel ${pickedEdges.length} edges` : 'Bevel an edge',
            componentId,
            bodyId,
            distance,
            edges: refs,
          }),
      })
    }

    if (picked && onThis) {
      const ventOn = (shape: VentShape, label: string, hint: string, initial: number) => ({
        id: `vent-${shape}`,
        label,
        hint,
        sub: 'Vent it',
        prompt: {
          label: shape === 'gyroid' ? 'Pattern size' : 'Hole size',
          initial,
          unit: 'mm',
        },
        prompt2: { label: 'Gap between', initial: 2, unit: 'mm' },
        run: (size: number, spacing?: number) =>
          store.addFeature({
            id: newId('vent'),
            kind: 'vent',
            name: 'Vent holes',
            componentId,
            bodyId,
            plane: {
              kind: 'face',
              face: { bodyId, anchor: picked.point, normal: picked.normal },
              offset: 0,
            },
            shape,
            size,
            spacing: spacing ?? 2,
            margin: 3,
            depth: 'through',
          }),
      })
      out.push(
        ventOn(
          'hex',
          'Hexagons',
          'The classic honeycomb. Webs the same width in every direction',
          6,
        ),
      )
      out.push(ventOn('round', 'Round holes', 'Plain and quiet. Prints cleanly at any size', 4))
      out.push(ventOn('square', 'Square holes', 'A grille. Reads as deliberate on a flat panel', 4))
      out.push(ventOn('triangle', 'Triangles', 'Alternating rows, so the webs stay even', 6))
      out.push(ventOn('diamond', 'Diamonds', 'Squares on their corner. No flat overhang to sag', 6))
      out.push(
        ventOn(
          'slot',
          'Slots',
          'Louvre bars with rounded ends, which is where a printed panel splits first',
          12,
        ),
      )
      out.push(
        ventOn(
          'cross',
          'Crosses',
          'Decorative. Arms a third of the span, so the webs stay even',
          7,
        ),
      )
      out.push(
        ventOn(
          'gyroid',
          'Gyroid weave',
          'One winding channel rather than separate holes. Slower to work out',
          14,
        ),
      )
    }

    out.push({
      id: 'round',
      label: 'Round all the edges',
      hint: 'Softens every corner at once',
      prompt: { label: 'Radius', initial: 2, unit: 'mm' },
      run: (radius) =>
        store.addFeature({
          id: newId('fillet'),
          kind: 'fillet',
          name: 'Round edges',
          componentId,
          bodyId,
          radius,
          edges: [],
        }),
    })
    out.push({
      id: 'bevel',
      label: 'Bevel all the edges',
      prompt: { label: 'Size', initial: 1, unit: 'mm' },
      run: (distance) =>
        store.addFeature({
          id: newId('chamfer'),
          kind: 'chamfer',
          name: 'Bevel edges',
          componentId,
          bodyId,
          distance,
          edges: [],
        }),
    })
    out.push({
      id: 'sketch-on-top',
      label: 'Draw on top of this',
      hint: 'Start a new outline on the highest face',
      run: () => {
        const bounds = bodyBounds(useStore.getState(), bodyId)
        store.startSketch({ kind: 'named', name: 'XY', offset: bounds ? bounds[5] : 0 }, bodyId)
      },
    })
    for (const other of component.bodies.filter((candidate) => candidate.id !== bodyId)) {
      const combine = (operation: 'join' | 'cut' | 'intersect') => () =>
        store.addFeature({
          id: newId('combine'),
          kind: 'combine',
          name:
            operation === 'join'
              ? `Join with ${other.name}`
              : operation === 'cut'
                ? `Cut away ${other.name}`
                : `Overlap with ${other.name}`,
          componentId,
          bodyId,
          toolBodyIds: [other.id],
          operation,
          keepTools: false,
        })
      out.push({
        id: `join-${other.id}`,
        label: `Join with ${other.name}`,
        hint: 'Fuses the two into one part',
        run: combine('join'),
      })
      out.push({
        id: `cut-${other.id}`,
        label: `Cut ${other.name} away from this`,
        hint: 'Uses it as a cookie cutter',
        run: combine('cut'),
      })
      out.push({
        id: `overlap-${other.id}`,
        label: `Keep only where they overlap`,
        hint: `The part they share with ${other.name}`,
        run: combine('intersect'),
      })
    }

    out.push({
      id: 'move',
      label: 'Move it',
      hint: 'Drag the arrows. Snaps to 1 mm',
      run: () => {
        ensureMove(bodyId)
        store.setGizmoMode('translate')
      },
    })
    out.push({
      id: 'turn',
      label: 'Turn it',
      hint: 'Drag a ring. Snaps to 15 degrees',
      run: () => {
        ensureMove(bodyId)
        store.setGizmoMode('rotate')
      },
    })

    const topOf = () => bodyBounds(useStore.getState(), bodyId)?.[5] ?? 0
    out.push({
      id: 'cut-ball',
      label: 'Cut a ball-shaped hollow',
      hint: 'Scoops a sphere out of the part, centred where you clicked',
      prompt: { label: 'Diameter', initial: 20, unit: 'mm' },
      run: (diameter) =>
        store.addFeature({
          id: newId('sphere'),
          kind: 'sphere',
          name: 'Ball hollow',
          componentId,
          plane: { kind: 'named', name: 'XY', offset: 0 },
          centre: picked ? [picked.point[0], picked.point[1]] : [0, 0],
          radius: diameter / 2,
          half: false,
          result: { kind: 'cut', bodyIds: [bodyId] },
        }),
    })
    out.push({
      id: 'cut-box',
      label: 'Cut a square hollow',
      prompt: { label: 'Across', initial: 20, unit: 'mm' },
      prompt2: { label: 'Deep', initial: 10, unit: 'mm' },
      run: (across, deep) =>
        store.addFeature({
          id: newId('box'),
          kind: 'box',
          name: 'Square hollow',
          componentId,
          plane: { kind: 'named', name: 'XY', offset: topOf() },
          origin: picked
            ? [picked.point[0] - across / 2, picked.point[1] - across / 2]
            : [-across / 2, -across / 2],
          width: across,
          depth: across,
          height: -(deep ?? 10),
          result: { kind: 'cut', bodyIds: [bodyId] },
        }),
    })

    out.push({
      id: 'negative',
      label: body.negative ? 'Make it solid again' : 'Turn it into a hole',
      hint: body.negative
        ? 'Back to being a part in its own right'
        : 'Cuts its shape out of every other part instead of being one',
      run: () => store.updateBody(bodyId, { negative: !body.negative }),
    })
    out.push({
      id: 'hide',
      label: 'Hide it',
      run: () => store.updateBody(bodyId, { visible: false }),
    })
    out.push({
      id: 'delete',
      label: 'Delete this part',
      danger: true,
      run: () => store.removeBody(bodyId),
    })
    return out
  }

  if (selection.kind === 'none') {
    const planes: Array<['XY' | 'XZ' | 'YZ', string]> = [
      ['XY', 'the top plane'],
      ['XZ', 'the front plane'],
      ['YZ', 'the right plane'],
    ]
    for (const [name, label] of planes) {
      out.push({
        id: `sketch-${name}`,
        label: `Start a sketch on ${label}`,
        run: () => store.startSketch({ kind: 'named', name, offset: 0 }),
      })
    }
    out.push({
      id: 'sketch-offset',
      label: 'Start a sketch above the top plane',
      hint: 'A parallel plane floating at a set height',
      prompt: { label: 'Height', initial: 20, unit: 'mm' },
      run: (offset) => store.startSketch({ kind: 'named', name: 'XY', offset }),
    })
    out.push({
      id: 'add-box',
      label: 'Add a box',
      hint: 'A plain rectangular block, no sketching needed',
      prompt: { label: 'Width', initial: 40, unit: 'mm', min: 0.01 },
      prompt2: { label: 'Depth', initial: 30, unit: 'mm', min: 0.01 },
      prompt3: { label: 'Height', initial: 20, unit: 'mm', min: 0.01 },
      run: (across, depth = 30, tall = 20) => {
        addPrimitive('Box', (componentId, bodyId) => ({
          id: newId('box'),
          kind: 'box',
          name: 'Box',
          componentId,
          plane: { kind: 'named', name: 'XY', offset: 0 },
          origin: [-across / 2, -depth / 2],
          width: across,
          depth,
          height: tall ?? 20,
          result: { kind: 'newBody', bodyId },
        }))
      },
    })
    out.push({
      id: 'add-cylinder',
      label: 'Add a cylinder',
      prompt: { label: 'Diameter', initial: 30, unit: 'mm', min: 0.01 },
      prompt2: { label: 'Height', initial: 20, unit: 'mm', min: 0.01 },
      run: (diameter, tall) => {
        addPrimitive('Cylinder', (componentId, bodyId) => ({
          id: newId('cyl'),
          kind: 'cylinder',
          name: 'Cylinder',
          componentId,
          plane: { kind: 'named', name: 'XY', offset: 0 },
          centre: [0, 0],
          radius: diameter / 2,
          height: tall ?? 20,
          result: { kind: 'newBody', bodyId },
        }))
      },
    })
    out.push({
      id: 'add-sphere',
      label: 'Add a ball',
      prompt: { label: 'Diameter', initial: 30, unit: 'mm', min: 0.01 },
      run: (diameter) => {
        addPrimitive('Ball', (componentId, bodyId) => ({
          id: newId('sphere'),
          kind: 'sphere',
          name: 'Ball',
          componentId,
          plane: { kind: 'named', name: 'XY', offset: 0 },
          centre: [0, 0],
          radius: diameter / 2,
          half: false,
          result: { kind: 'newBody', bodyId },
        }))
      },
    })
    out.push({
      id: 'add-dome',
      label: 'Add a dome',
      hint: 'Half a ball, flat side down',
      prompt: { label: 'Diameter', initial: 30, unit: 'mm', min: 0.01 },
      run: (diameter) => {
        addPrimitive('Dome', (componentId, bodyId) => ({
          id: newId('sphere'),
          kind: 'sphere',
          name: 'Dome',
          componentId,
          plane: { kind: 'named', name: 'XY', offset: 0 },
          centre: [0, 0],
          radius: diameter / 2,
          half: true,
          result: { kind: 'newBody', bodyId },
        }))
      },
    })
    out.push({
      id: 'sketch-tilted',
      label: 'Start a sketch on a tilted plane',
      hint: 'The top plane tipped over, for sloped faces and brackets',
      prompt: { label: 'Tilt', initial: 30, unit: 'deg' },
      run: (angle) =>
        store.startSketch({
          kind: 'angled',
          name: 'XY',
          tiltAxis: 'x',
          angle,
          offset: 0,
        }),
    })
    out.push({
      id: 'create-component',
      label: 'New Component',
      hint: 'An empty component inside the active one. It becomes the active component.',
      run: () => store.createComponent(),
    })
    return raw
  }

  if (selection.kind === 'occurrence' && selection.id) {
    const id = selection.id
    const occurrence = findOccurrence(doc, id)
    const component = occurrence ? findComponent(doc, occurrence.componentId) : undefined
    if (!occurrence || !component) return raw
    const pose = poseOf(occurrence.transform)
    const catalogue = component.source.kind === 'catalogue'
    const part =
      component.source.kind === 'catalogue' ? getPart(component.source.partId) : undefined
    const targetBody = targetBodyId ?? targetBodies(doc)[0]?.value

    out.push({
      id: 'move',
      label: 'Move it',
      hint: 'Drag the arrows. Snaps to 1 mm',
      run: () => store.setGizmoMode('translate'),
    })
    out.push({
      id: 'turn',
      label: 'Turn it',
      hint: 'Drag the ring. Snaps to 15 degrees',
      run: () => store.setGizmoMode('rotate'),
    })
    out.push({
      id: 'linked-copy',
      label: 'Linked Copy',
      hint: 'Another occurrence of the same component. Changing one changes both.',
      run: () => store.linkedCopy(id),
    })
    if (!catalogue) {
      out.push({
        id: 'activate',
        label: 'Activate Component',
        hint: 'New sketches, bodies and features go into this component.',
        run: () => store.activateComponent(component.id),
      })
    }

    const holes = part?.mountingHoles
    const add = (kind: 'holes' | 'standoffs' | 'ports', height?: number) => {
      if (!targetBody) return
      const feature = mountFeature(kind, id, targetBody, {
        height,
        instanceId: selection.instanceId,
      })
      if (feature) store.addFeature(feature)
    }
    if (targetBody && holes?.length) {
      out.push({
        id: 'holes',
        label: 'Put its mounting holes in',
        hint: `${holes.length} holes, cut right through`,
        run: () => add('holes'),
      })
      out.push({
        id: 'standoffs',
        label: 'Stand it off on pillars',
        prompt: { label: 'Height', initial: 6, unit: 'mm' },
        run: (height) => add('standoffs', height),
      })
    }
    if (targetBody && part?.connectors?.length) {
      out.push({
        id: 'ports',
        label: 'Cut its port openings',
        hint: part.connectors
          .map((c) => c.label)
          .slice(0, 3)
          .join(', '),
        run: () => add('ports'),
      })
    }

    out.push({
      id: 'negative',
      label: occurrence.negative ? 'Make it solid again' : 'Turn it into a hole',
      hint: occurrence.negative
        ? 'Back to being a part sitting there'
        : 'Cuts a recess of exactly this shape into everything around it',
      run: () => store.updateOccurrence(id, { negative: !occurrence.negative }),
    })
    out.push({
      id: 'flip',
      label: pose.flipped ? 'Turn it right way up' : 'Flip it upside down',
      run: () =>
        store.updateOccurrence(id, {
          transform: withPose(occurrence.transform, { flipped: !pose.flipped }),
        }),
    })
    out.push({
      id: 'delete',
      label: catalogue ? 'Remove this part' : 'Delete this component',
      danger: true,
      run: () => store.removeOccurrence(id),
    })
  }

  return raw
}

export function ObjectMenu({
  x,
  y,
  actions,
  onClose,
}: {
  x: number
  y: number
  actions: ObjectAction[]
  onClose: () => void
}) {
  return (
    <ContextMenu
      x={x}
      y={y}
      actions={actions}
      order={OBJECT_GROUP_ORDER}
      onClose={onClose}
      onPick={(action) => {
        onClose()
        chooseAction(action)
      }}
    />
  )
}
