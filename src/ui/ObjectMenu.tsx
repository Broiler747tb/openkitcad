import { useEffect, useRef, useState } from 'react'
import { newId, useStore, type Selection } from '../doc/store'
import type {
  ExtrudeFeature,
  MoveFeature,
  OkcDocument,
  LidFit,
  SketchFeature,
  VentShape,
} from '../doc/types'
import { resizeSketch } from '../sketch/edit'
import { getPart } from '../catalogue'
import { FlyoutMenu } from './FlyoutMenu'

/**
 * Right-click menu for finished solids and placed parts.
 *
 * The feature tree already exposes all of this, but a beginner looking at a
 * plate on screen does not think "I should find the extrude step in the tree
 * and change its distance". They think "make this thicker". This menu is that
 * sentence.
 */
interface PromptField {
  label: string
  initial: number
  unit: string
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


/**
 * Menu headings, keyed off the action id.
 *
 * Combining is matched by prefix because there is one entry per other body in
 * the document, and with a few bodies that section alone is longer than the
 * rest of the menu put together.
 */
const OBJECT_GROUPS: Array<[string, string[]]> = [
  ['Start a sketch', ['sketch-XY', 'sketch-XZ', 'sketch-YZ', 'sketch-offset', 'sketch-tilted']],
  ['Add a shape', ['add-box', 'add-cylinder', 'add-sphere', 'add-dome']],
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

/**
 * The move step at the end of a body's history, if it has one.
 *
 * Only the trailing step counts. A move part way up the history was put there
 * deliberately - there is geometry built on top of it - so nudging the part
 * about must not reach back and disturb it.
 */
export function trailingMove(doc: OkcDocument, bodyId: string): MoveFeature | undefined {
  const body = doc.bodies.find((b) => b.id === bodyId)
  const last = body?.features[body.features.length - 1]
  return last?.kind === 'move' ? last : undefined
}

/** Find that step, or start one, so the gizmo has something to drive. */
function ensureMove(bodyId: string): void {
  const store = useStore.getState()
  if (trailingMove(store.doc, bodyId)) return
  store.addFeature(bodyId, {
    id: newId('move'),
    kind: 'move',
    name: 'Move',
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

/** The extrude that actually made this body, if there is one. */
function mainExtrude(doc: OkcDocument, bodyId: string): ExtrudeFeature | undefined {
  const body = doc.bodies.find((b) => b.id === bodyId)
  return body?.features.find((f): f is ExtrudeFeature => f.kind === 'extrude')
}

/** Where the user right-clicked, so "draw on this face" knows which face. */
export interface PickedFace {
  bodyId: string
  point: [number, number, number]
  normal: [number, number, number]
}

/**
 * Sort the sections the way OBJECT_GROUPS lists them.
 *
 * The flyout keeps the section list in a fixed left-hand column, so the order
 * has to be the same every time for it to become muscle memory. Ordering by
 * whichever section happened to be built first would shuffle it about.
 */
export const OBJECT_GROUP_ORDER = [
  ...OBJECT_GROUPS.map(([name]) => name),
  'Combine with another part',
]

/**
 * Tagging happens here, at the one exit, rather than at each of the five
 * returns inside. Doing it per-return meant a path could be missed - and one
 * was, so right-clicking a solid came back with no sections at all.
 */
/**
 * The four things done often enough to deserve the top of the menu.
 *
 * Everything else is a phrase you read; these are a shape you aim at. They are
 * lifted out of the sections below rather than repeated in both, because an
 * action in two places is an action somebody has to decide between.
 *
 * Glyphs rather than words: at four items a row of icons is quicker to hit than
 * four lines of text, and these four are distinct enough not to need reading.
 */
const QUICK: Array<{ id: string; glyph: string; short: string }> = [
  { id: 'move', glyph: '✥', short: 'Move' },
  { id: 'turn', glyph: '↻', short: 'Turn' },
  { id: 'negative', glyph: '⊘', short: 'Hole' },
  { id: 'delete', glyph: '✕', short: 'Delete' },
]

export function objectActions(
  selection: Selection,
  picked?: PickedFace | null,
): ObjectAction[] {
  return buildObjectActions(selection, picked).map((a) => ({
    ...a,
    group: objectGroupOf(a.id),
  }))
}

function buildObjectActions(
  selection: Selection,
  picked?: PickedFace | null,
): ObjectAction[] {
  const store = useStore.getState()
  const doc = store.doc
  const raw: ObjectAction[] = []
  const out = raw

  if (selection.kind === 'body' && selection.id) {
    const bodyId = selection.id
    const body = doc.bodies.find((b) => b.id === bodyId)
    if (!body) return raw
    const extrude = mainExtrude(doc, bodyId)
    const sketchId = extrude?.sketchId ?? body.features.find((f) => f.kind === 'sketch')?.id

    // The headline action: draw directly on the face under the cursor. Without
    // this you can only ever sketch on the three base planes, which means you
    // cannot put a hole in the side of a box.
    if (picked && picked.bodyId === bodyId) {
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

    if (sketchId) {
      out.push({
        id: 'edit-sketch',
        label: 'Edit the shape this was drawn from',
        hint: 'Go back to the outline and change it',
        run: () => store.openSketch(bodyId, sketchId),
      })
    }
    // "Change its size" covers whichever way the part was made: typed-in
    // shapes carry their sides directly, drawn ones have to have the outline
    // stretched underneath them.
    const solid = body.features.find(
      (f) => f.kind === 'box' || f.kind === 'cylinder',
    )
    if (solid?.kind === 'box') {
      out.push({
        id: 'size',
        label: 'Change its size',
        hint: 'Width, depth and height',
        prompt: { label: 'Width', initial: solid.width, unit: 'mm' },
        prompt2: { label: 'Depth', initial: solid.depth, unit: 'mm' },
        prompt3: { label: 'Height', initial: solid.height, unit: 'mm' },
        run: (width, depth, height) =>
          store.updateFeature(bodyId, solid.id, {
            width,
            depth: depth ?? solid.depth,
            height: height ?? solid.height,
          } as never),
      })
    } else if (solid?.kind === 'cylinder') {
      out.push({
        id: 'size',
        label: 'Change its size',
        hint: 'Across and tall',
        prompt: { label: 'Diameter', initial: solid.radius * 2, unit: 'mm' },
        prompt2: { label: 'Height', initial: solid.height, unit: 'mm' },
        run: (diameter, height) =>
          store.updateFeature(bodyId, solid.id, {
            radius: diameter / 2,
            height: height ?? solid.height,
          } as never),
      })
    } else if (extrude) {
      const drawn = body.features.find(
        (f): f is SketchFeature => f.kind === 'sketch' && f.id === extrude.sketchId,
      )
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
            store.updateFeature(bodyId, extrude.id, { distance: a } as never)
            return
          }
          const thickness = c ?? extrude.distance
          const resized = resizeSketch(drawn.sketch, a / box.width, (b ?? box.height) / box.height)
          if (!resized.ok) {
            // Say why rather than silently applying half of it.
            store.setStatus(resized.reason)
            store.updateFeature(bodyId, extrude.id, { distance: thickness } as never)
            return
          }
          store.updateFeature(bodyId, drawn.id, { sketch: resized.sketch } as never)
          store.updateFeature(bodyId, extrude.id, { distance: thickness } as never)
        },
      })
    }
    if (picked && picked.bodyId === bodyId) {
      const hollowOut = (
        thickness: number,
        withLid: boolean,
        clearance = 0,
        fit: LidFit = 'friction',
      ) => {
        const shellId = newId('shell')
        store.addFeature(bodyId, {
          id: shellId,
          kind: 'shell',
          name: 'Hollow out',
          thickness,
          openFaces: [{ bodyId, anchor: picked.point, normal: picked.normal }],
        })
        if (!withLid) return
        // The lid is its own body: you print it separately, and you want to be
        // able to hide it to see inside.
        const lidBody = store.addBody(`${body.name} lid`)
        const lidId = newId('lid')
        store.addFeature(lidBody, {
          id: lidId,
          kind: 'lid',
          name: 'Lid',
          sourceBodyId: bodyId,
          shellFeatureId: shellId,
          thickness,
          clearance,
          fit,
        })
        // The matching half - the step or the groove - is cut into the box, so
        // it belongs in the box's history rather than the lid's. Nothing is
        // needed for a plain drop-in lid.
        if (fit !== 'friction') {
          store.addFeature(bodyId, {
            id: newId('seat'),
            kind: 'lidSocket',
            name: fit === 'ledge' ? 'Ledge for the lid' : 'Groove for the lid',
            lidBodyId: lidBody,
            lidFeatureId: lidId,
          })
        }
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
        // A fifth of a millimetre is the usual starting point for a printed
        // part that has to go into another printed part. It is a prompt rather
        // than a fixed number because the right gap depends on the printer.
        prompt2: { label: 'Gap round the lid', initial: 0.2, unit: 'mm' },
        run: (thickness, clearance, _third, fit) =>
          hollowOut(thickness, true, clearance ?? 0.2, (fit as LidFit) ?? 'ledge'),
      })
    }
    // Anything picked with shift takes priority over the blanket versions,
    // because "round these three edges" is nearly always what was meant when
    // the user went to the trouble of selecting them.
    const pickedEdges = store.subSelection.filter(
      (s) => s.bodyId === bodyId && s.kind === 'edge',
    )
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
          store.addFeature(bodyId, {
            id: newId('fillet'),
            kind: 'fillet',
            name: many ? `Round ${pickedEdges.length} edges` : 'Round an edge',
            radius,
            edges: refs,
          }),
      })
      out.push({
        id: 'bevel-picked',
        label: `Bevel ${many ? `these ${pickedEdges.length} edges` : 'this edge'}`,
        prompt: { label: 'Size', initial: 1, unit: 'mm' },
        run: (distance) =>
          store.addFeature(bodyId, {
            id: newId('chamfer'),
            kind: 'chamfer',
            name: many ? `Bevel ${pickedEdges.length} edges` : 'Bevel an edge',
            distance,
            edges: refs,
          }),
      })
    }

    if (picked && picked.bodyId === bodyId) {
      const ventOn = (shape: VentShape, label: string, hint: string, initial: number) => ({
        id: `vent-${shape}`,
        label,
        // Every vent leaves a solid border round the edge of the face. Without
        // it the pattern runs off the side and prints as loose threads.
        hint,
        sub: 'Vent it',
        prompt: {
          label: shape === 'gyroid' ? 'Pattern size' : 'Hole size',
          initial,
          unit: 'mm',
        },
        prompt2: { label: 'Gap between', initial: 2, unit: 'mm' },
        run: (size: number, spacing?: number) =>
          store.addFeature(bodyId, {
            id: newId('vent'),
            kind: 'vent',
            name: 'Vent holes',
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
      out.push(ventOn('hex', 'Hexagons', 'The classic honeycomb. Webs the same width in every direction', 6))
      out.push(ventOn('round', 'Round holes', 'Plain and quiet. Prints cleanly at any size', 4))
      out.push(ventOn('square', 'Square holes', 'A grille. Reads as deliberate on a flat panel', 4))
      out.push(ventOn('triangle', 'Triangles', 'Alternating rows, so the webs stay even', 6))
      out.push(ventOn('diamond', 'Diamonds', 'Squares on their corner. No flat overhang to sag', 6))
      out.push(ventOn('slot', 'Slots', 'Louvre bars with rounded ends, which is where a printed panel splits first', 12))
      out.push(ventOn('cross', 'Crosses', 'Decorative. Arms a third of the span, so the webs stay even', 7))
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
        store.addFeature(bodyId, {
          id: newId('fillet'),
          kind: 'fillet',
          name: 'Round edges',
          radius,
          edges: [],
        }),
    })
    out.push({
      id: 'bevel',
      label: 'Bevel all the edges',
      prompt: { label: 'Size', initial: 1, unit: 'mm' },
      run: (distance) =>
        store.addFeature(bodyId, {
          id: newId('chamfer'),
          kind: 'chamfer',
          name: 'Bevel edges',
          distance,
          edges: [],
        }),
    })
    out.push({
      id: 'sketch-on-top',
      label: 'Draw on top of this',
      hint: 'Start a new outline on the highest face',
      run: () => {
        const shape = store.shapes.find((s) => s.id === bodyId)
        store.startSketch(
          { kind: 'named', name: 'XY', offset: shape ? shape.bounds[5] : 0 },
          bodyId,
        )
      },
    })
    // One entry per other body rather than a picker: with the handful of bodies
    // a project this size has, naming them outright is faster to read and
    // impossible to get wrong.
    const others = doc.bodies.filter((other) => other.id !== bodyId)
    const positionOf = (id: string) => doc.bodies.findIndex((x) => x.id === id)
    for (const other of others) {
      const later = positionOf(other.id) > positionOf(bodyId)
      const note = later
        ? ` (will move "${other.name}" above this one first)`
        : ''
      const withOrdering = (op: 'add' | 'cut' | 'intersect') => () => {
        // Bodies build top to bottom, so the tool has to come first.
        if (later) store.moveBodyBefore(other.id, bodyId)
        store.addFeature(bodyId, {
          id: newId('combine'),
          kind: 'combine',
          name:
            op === 'add'
              ? `Join with ${other.name}`
              : op === 'cut'
                ? `Cut away ${other.name}`
                : `Overlap with ${other.name}`,
          otherBodyId: other.id,
          operation: op,
          keepOther: false,
        })
      }
      out.push({
        id: `join-${other.id}`,
        label: `Join with ${other.name}`,
        hint: `Fuses the two into one part${note}`,
        run: withOrdering('add'),
      })
      out.push({
        id: `cut-${other.id}`,
        label: `Cut ${other.name} away from this`,
        hint: `Uses it as a cookie cutter${note}`,
        run: withOrdering('cut'),
      })
      out.push({
        id: `overlap-${other.id}`,
        label: `Keep only where they overlap`,
        hint: `The part they share with ${other.name}${note}`,
        run: withOrdering('intersect'),
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

    // Simple shapes used as cutters. Quicker than sketching for the common
    // "knock a round hollow out of that" jobs.
    const topOf = () => {
      const built = store.shapes.find((x) => x.id === bodyId)
      return built ? built.bounds[5] : 0
    }
    out.push({
      id: 'cut-ball',
      label: 'Cut a ball-shaped hollow',
      hint: 'Scoops a sphere out of the part, centred where you clicked',
      prompt: { label: 'Diameter', initial: 20, unit: 'mm' },
      run: (diameter) =>
        store.addFeature(bodyId, {
          id: newId('sphere'),
          kind: 'sphere',
          name: 'Ball hollow',
          plane: { kind: 'named', name: 'XY', offset: 0 },
          centre: picked ? [picked.point[0], picked.point[1]] : [0, 0],
          radius: diameter / 2,
          half: false,
          operation: 'cut',
        }),
    })
    out.push({
      id: 'cut-box',
      label: 'Cut a square hollow',
      prompt: { label: 'Across', initial: 20, unit: 'mm' },
      prompt2: { label: 'Deep', initial: 10, unit: 'mm' },
      run: (across, deep) =>
        store.addFeature(bodyId, {
          id: newId('box'),
          kind: 'box',
          name: 'Square hollow',
          plane: { kind: 'named', name: 'XY', offset: topOf() },
          origin: picked
            ? [picked.point[0] - across / 2, picked.point[1] - across / 2]
            : [-across / 2, -across / 2],
          width: across,
          depth: across,
          height: -(deep ?? 10),
          operation: 'cut',
        }),
    })

    out.push({
      id: 'negative',
      label: body.negative ? 'Make it solid again' : 'Turn it into a hole',
      hint: body.negative
        ? 'Back to being a part in its own right'
        : 'Cuts its shape out of every other part instead of being one',
      run: () =>
        store.commit((d) => {
          const target = d.bodies.find((x) => x.id === bodyId)
          if (target) target.negative = !target.negative
        }),
    })
    out.push({
      id: 'hide',
      label: 'Hide it',
      run: () =>
        store.commit((d) => {
          const target = d.bodies.find((x) => x.id === bodyId)
          if (target) target.visible = false
        }),
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
      prompt: { label: 'Across', initial: 40, unit: 'mm' },
      prompt2: { label: 'Tall', initial: 20, unit: 'mm' },
      run: (across, tall) => {
        const id = store.addBody('Box')
        store.addFeature(id, {
          id: newId('box'),
          kind: 'box',
          name: 'Box',
          plane: { kind: 'named', name: 'XY', offset: 0 },
          origin: [-across / 2, -across / 2],
          width: across,
          depth: across,
          height: tall ?? 20,
          operation: 'new',
        })
      },
    })
    out.push({
      id: 'add-cylinder',
      label: 'Add a cylinder',
      prompt: { label: 'Diameter', initial: 30, unit: 'mm' },
      prompt2: { label: 'Tall', initial: 20, unit: 'mm' },
      run: (diameter, tall) => {
        const id = store.addBody('Cylinder')
        store.addFeature(id, {
          id: newId('cyl'),
          kind: 'cylinder',
          name: 'Cylinder',
          plane: { kind: 'named', name: 'XY', offset: 0 },
          centre: [0, 0],
          radius: diameter / 2,
          height: tall ?? 20,
          operation: 'new',
        })
      },
    })
    out.push({
      id: 'add-sphere',
      label: 'Add a ball',
      prompt: { label: 'Diameter', initial: 30, unit: 'mm' },
      run: (diameter) => {
        const id = store.addBody('Ball')
        store.addFeature(id, {
          id: newId('sphere'),
          kind: 'sphere',
          name: 'Ball',
          plane: { kind: 'named', name: 'XY', offset: 0 },
          centre: [0, 0],
          radius: diameter / 2,
          half: false,
          operation: 'new',
        })
      },
    })
    out.push({
      id: 'add-dome',
      label: 'Add a dome',
      hint: 'Half a ball, flat side down',
      prompt: { label: 'Diameter', initial: 30, unit: 'mm' },
      run: (diameter) => {
        const id = store.addBody('Dome')
        store.addFeature(id, {
          id: newId('sphere'),
          kind: 'sphere',
          name: 'Dome',
          plane: { kind: 'named', name: 'XY', offset: 0 },
          centre: [0, 0],
          radius: diameter / 2,
          half: true,
          operation: 'new',
        })
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
    return raw
  }

  if (selection.kind === 'placement' && selection.id) {
    const id = selection.id
    const placement = doc.placements.find((p) => p.id === id)
    if (!placement) return raw
    const part = getPart(placement.partId)
    const targetBody = doc.bodies[0]?.id

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

    const holes = part?.mountingHoles
    if (targetBody && holes?.length) {
      const drillZ = () => {
        const shape = store.shapes.find((s) => s.id === targetBody)
        return shape ? shape.bounds[5] : placement.position[2]
      }
      out.push({
        id: 'holes',
        label: 'Put its mounting holes in',
        hint: `${holes.length} holes, cut right through`,
        run: () =>
          store.addFeature(targetBody, {
            id: newId('hole'),
            kind: 'hole',
            name: `Holes for ${placement.name}`,
            plane: { kind: 'named', name: 'XY', offset: drillZ() },
            source: { kind: 'placement', placementId: id },
            style: 'counterbore',
            diameter: (holes[0].diameter ?? 3) + 0.2,
            depth: 'through',
            counterboreDiameter: (holes[0].diameter ?? 3) + 3,
            counterboreDepth: 2,
          }),
      })
      out.push({
        id: 'standoffs',
        label: 'Stand it off on pillars',
        prompt: { label: 'Height', initial: 6, unit: 'mm' },
        run: (height) =>
          store.addFeature(targetBody, {
            id: newId('standoff'),
            kind: 'standoff',
            name: `Standoffs for ${placement.name}`,
            plane: { kind: 'named', name: 'XY', offset: drillZ() },
            source: { kind: 'placement', placementId: id },
            height,
            outerDiameter: (holes[0].diameter ?? 3) + 3,
            boreDiameter: Math.max((holes[0].diameter ?? 3) - 0.6, 1.2),
            boreDepth: Math.max(height - 1, 2),
          }),
      })
    }
    if (targetBody && part?.connectors?.length) {
      out.push({
        id: 'ports',
        label: 'Cut its port openings',
        hint: part.connectors.map((c) => c.label).slice(0, 3).join(', '),
        run: () =>
          store.addFeature(targetBody, {
            id: newId('ports'),
            kind: 'portCutout',
            name: `Openings for ${placement.name}`,
            placementId: id,
            connectorIds: [],
            tolerance: 0.6,
          }),
      })
    }

    out.push({
      id: 'negative',
      label: placement.negative ? 'Make it solid again' : 'Turn it into a hole',
      hint: placement.negative
        ? 'Back to being a part sitting there'
        : 'Cuts a recess of exactly this shape into everything around it',
      run: () => store.updatePlacement(id, { negative: !placement.negative }),
    })
    out.push({
      id: 'flip',
      label: placement.flipped ? 'Turn it right way up' : 'Flip it upside down',
      run: () => store.updatePlacement(id, { flipped: !placement.flipped }),
    })
    out.push({
      id: 'delete',
      label: 'Remove this part',
      danger: true,
      run: () => store.removePlacement(id),
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
  const [pending, setPending] = useState<ObjectAction | null>(null)
  const [choiceHint, setChoiceHint] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const secondRef = useRef<HTMLInputElement>(null)
  const thirdRef = useRef<HTMLInputElement>(null)
  const choiceRef = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const timer = setTimeout(() => {
      window.addEventListener('pointerdown', away)
      window.addEventListener('keydown', key)
    }, 0)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])

  const fire = (
    action: ObjectAction,
    value: number,
    value2?: number,
    value3?: number,
    choice?: string,
  ) => {
    action.run(value, value2, value3, choice)
    onClose()
  }

  /** Commit the pending action, reading whichever fields it asked for. */
  const commit = (first: HTMLInputElement) => {
    if (!pending) return
    const a = Number(first.value)
    const b = pending.prompt2 ? Number(secondRef.current?.value) : undefined
    const c = pending.prompt3 ? Number(thirdRef.current?.value) : undefined
    if (!Number.isFinite(a)) return
    if (pending.prompt2 && !Number.isFinite(b as number)) return
    if (pending.prompt3 && !Number.isFinite(c as number)) return
    fire(pending, a, b, c, choiceRef.current?.value)
  }

  return (
    <div
      className="sketch-menu"
      ref={ref}
      style={{
        left: Math.min(x, window.innerWidth - 260),
        top: Math.min(y, window.innerHeight - 300),
      }}
    >
      {pending ? (
        <>
          {pending.choice && (
            <div className="sketch-menu-choice">
              <label>{pending.choice.label}</label>
              <select
                ref={choiceRef}
                defaultValue={pending.choice.initial}
                onChange={() => setChoiceHint(choiceRef.current?.value ?? '')}
              >
                {pending.choice.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {(() => {
                const picked = pending.choice.options.find(
                  (o) => o.value === (choiceHint || pending.choice!.initial),
                )
                return picked?.hint ? <p>{picked.hint}</p> : null
              })()}
            </div>
          )}
          <div className="sketch-menu-prompt">
            <label>{pending.prompt!.label}</label>
            <input
              autoFocus
              type="number"
              step="0.5"
              defaultValue={pending.prompt!.initial}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit(e.target as HTMLInputElement)
                if (e.key === 'Escape') setPending(null)
              }}
            />
            <span>{pending.prompt!.unit}</span>
          </div>
          {pending.prompt2 && (
            <div className="sketch-menu-prompt">
              <label>{pending.prompt2.label}</label>
              <input
                ref={secondRef}
                type="number"
                step="0.5"
                defaultValue={pending.prompt2.initial}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const first = ref.current?.querySelector('input')
                    if (first) commit(first as HTMLInputElement)
                  }
                  if (e.key === 'Escape') setPending(null)
                }}
              />
              <span>{pending.prompt2.unit}</span>
            </div>
          )}
          {pending.prompt3 && (
            <div className="sketch-menu-prompt">
              <label>{pending.prompt3.label}</label>
              <input
                ref={thirdRef}
                type="number"
                step="0.5"
                defaultValue={pending.prompt3.initial}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const first = ref.current?.querySelector('input')
                    if (first) commit(first as HTMLInputElement)
                  }
                  if (e.key === 'Escape') setPending(null)
                }}
              />
              <span>{pending.prompt3.unit}</span>
            </div>
          )}
        </>
      ) : actions.length === 0 ? (
        <div className="sketch-menu-empty">Right-click a part to change it.</div>
      ) : (
        <>
          {(() => {
            const quick = QUICK.map((q) => ({
              ...q,
              action: actions.find((a) => a.id === q.id),
            })).filter((q) => q.action)
            if (!quick.length) return null
            return (
              <div className="quick-row">
                {quick.map((q) => (
                  <button
                    key={q.id}
                    className="quick"
                    // The label is the action's own, so "Turn it into a hole"
                    // reads "Make it solid again" once it already is one.
                    title={q.action!.label}
                    aria-label={q.action!.label}
                    onClick={() =>
                      q.action!.prompt ? setPending(q.action!) : fire(q.action!, 0)
                    }
                  >
                    <span className="quick-glyph">{q.glyph}</span>
                    <span className="quick-name">{q.short}</span>
                  </button>
                ))}
              </div>
            )
          })()}
          <FlyoutMenu
            actions={actions.filter((a) => !QUICK.some((q) => q.id === a.id))}
            order={OBJECT_GROUP_ORDER}
            onPick={(action) => (action.prompt ? setPending(action) : fire(action, 0))}
          />
        </>
      )}
    </div>
  )
}
