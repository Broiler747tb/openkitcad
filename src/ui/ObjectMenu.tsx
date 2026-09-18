import {
  bodyBounds,
  componentInstance,
  newId,
  occurrencePathOf,
  targetBodies,
  useStore,
  type Selection,
} from '../doc/store'
import type {
  ElementRef,
  ExtrudeFeature,
  Feature,
  MoveFeature,
  OkcDocument,
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
import { getPart } from '../catalogue'
import { ContextMenu, type MenuRect } from './ContextMenu'
import { chooseAction } from './ActionDialog'
import { canEditInPanel, editFeature, startCommand } from './command/commands'
import { setGrounded, updateJoint } from './command/specs/assemble'
import { animateJoint } from './jointAnimation'
import { motionDofs } from '../assembly/motion'
import { bodyPick, elementPick, occurrencePick } from './command/picks'
import { counted } from '../core/words'

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
  ['Sketch', ['sketch-XY', 'sketch-XZ', 'sketch-YZ', 'sketch-offset', 'sketch-tilted']],
  ['Create', ['add-box', 'add-cylinder', 'add-sphere', 'add-dome']],
  [
    'Assemble',
    [
      'create-component',
      'linked-copy',
      'activate',
      'ground',
      'joint',
      'rigid-group',
      'edit-joint',
      'drive-joint',
      'animate-joint',
      'lock-joint',
    ],
  ],
  ['Sketch on Body', ['sketch-on-face', 'sketch-on-top', 'edit-sketch']],
  [
    'Modify',
    [
      'size',
      'press-pull',
      'draft',
      'hollow',
      'hollow-lid',
      'round-picked',
      'bevel-picked',
      'round',
      'bevel',
    ],
  ],
  [
    'Cut',
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
  ['Move', ['move', 'turn', 'flip']],
  ['Hardware', ['holes', 'standoffs', 'ports']],
  ['Body', ['negative', 'hide', 'delete']],
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
  name: string
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
    const onThis = !!picked && picked.bodyId === bodyId && !!picked.name

    if (picked && onThis) {
      out.push({
        id: 'sketch-on-face',
        label: 'Create Sketch',
        hint: 'Starts a sketch right on the face you clicked',
        run: () =>
          store.startSketch(
            {
              kind: 'face',
              face: { bodyId, kind: 'face', name: picked.name },
              offset: 0,
            },
            bodyId,
          ),
      })
    }

    if (sketchId && findFeature(doc, sketchId)?.kind === 'sketch') {
      out.push({
        id: 'edit-sketch',
        label: 'Edit Sketch',
        hint: 'Goes back to the sketch this was built from',
        run: () => store.openSketch(sketchId),
      })
    }
    const creator = bodyCreator(doc, bodyId)
    const editable =
      creator?.kind === 'box' || creator?.kind === 'cylinder'
        ? creator
        : extrude && canEditInPanel(extrude)
          ? extrude
          : undefined
    if (editable) {
      out.push({
        id: 'size',
        label: 'Edit Feature',
        hint:
          editable.kind === 'box'
            ? 'Opens the Box panel: sizes, height and operation'
            : editable.kind === 'cylinder'
              ? 'Opens the Cylinder panel: diameter, height and operation'
              : 'Opens the Extrude panel: distance, direction and operation',
        run: () => editFeature(editable),
      })
    }
    const facePicks = () =>
      picked
        ? [
            elementPick(doc, { bodyId, kind: 'face', name: picked.name }, picked.instanceId, {
              point: picked.point,
              normal: picked.normal,
            }),
          ].flatMap((pick) => pick ?? [])
        : []
    const thisBody = () => [bodyPick(doc, bodyId)].flatMap((pick) => pick ?? [])
    if (picked && onThis) {
      out.push({
        id: 'press-pull',
        label: 'Press Pull',
        hint: 'Pulls this face out or pushes it in',
        run: () => startCommand('pressPull', { faces: facePicks() }),
      })
      out.push({
        id: 'draft',
        label: 'Draft',
        hint: 'Tilts this face by an angle so the part comes out of a mould',
        run: () => startCommand('draft', { faces: facePicks() }),
      })
      out.push({
        id: 'hollow',
        label: 'Shell',
        hint: 'Hollows the body into even walls, open at this face',
        run: () => startCommand('shell', { faces: facePicks() }),
      })
      out.push({
        id: 'hollow-lid',
        label: 'Shell with Lid',
        hint: 'Hollows the body and makes this side a lid that closes it',
        run: () => startCommand('shell', { faces: facePicks(), lid: true }),
      })
    }
    const pickedEdges = store.subSelection.filter(
      (s) => s.bodyId === bodyId && s.kind === 'edge' && !!s.name,
    )
    if (pickedEdges.length > 0) {
      const edgePicks = () =>
        pickedEdges.flatMap(
          (s) =>
            elementPick(doc, { bodyId, kind: 'edge', name: s.name } as ElementRef, s.instanceId) ??
            [],
        )
      const many = pickedEdges.length > 1
      out.push({
        id: 'round-picked',
        label: 'Fillet',
        hint: `Rounds ${many ? `the ${pickedEdges.length} edges` : 'the edge'} you selected`,
        run: () => startCommand('fillet', { edges: edgePicks() }),
      })
      out.push({
        id: 'bevel-picked',
        label: 'Chamfer',
        hint: `Bevels ${many ? `the ${pickedEdges.length} edges` : 'the edge'} you selected`,
        run: () => startCommand('chamfer', { edges: edgePicks() }),
      })
    }

    if (picked && onThis) {
      const ventOn = (shape: VentShape, label: string, hint: string) => ({
        id: `vent-${shape}`,
        label,
        hint,
        sub: 'Vent it',
        run: () => startCommand('vent', { face: facePicks(), shape }),
      })
      out.push(
        ventOn('hex', 'Hexagons', 'The classic honeycomb. Webs the same width in every direction'),
      )
      out.push(ventOn('round', 'Round holes', 'Plain and quiet. Prints cleanly at any size'))
      out.push(ventOn('square', 'Square holes', 'A grille. Reads as deliberate on a flat panel'))
      out.push(ventOn('triangle', 'Triangles', 'Alternating rows, so the webs stay even'))
      out.push(ventOn('diamond', 'Diamonds', 'Squares on their corner. No flat overhang to sag'))
      out.push(
        ventOn(
          'slot',
          'Slots',
          'Louvre bars with rounded ends, which is where a printed panel splits first',
        ),
      )
      out.push(
        ventOn('cross', 'Crosses', 'Decorative. Arms a third of the span, so the webs stay even'),
      )
      out.push(
        ventOn(
          'gyroid',
          'Gyroid weave',
          'One winding channel rather than separate holes. Slower to work out',
        ),
      )
    }

    out.push({
      id: 'round',
      label: 'Fillet All Edges',
      hint: 'Rounds every edge at once',
      run: () => startCommand('fillet', { edges: thisBody() }),
    })
    out.push({
      id: 'bevel',
      label: 'Chamfer All Edges',
      hint: 'Bevels every edge at once',
      run: () => startCommand('chamfer', { edges: thisBody() }),
    })
    out.push({
      id: 'sketch-on-top',
      label: 'Create Sketch on Top',
      hint: 'Starts a sketch on the highest face',
      run: () => {
        const bounds = bodyBounds(useStore.getState(), bodyId)
        store.startSketch({ kind: 'named', name: 'XY', offset: bounds ? bounds[5] : 0 }, bodyId)
      },
    })
    for (const other of component.bodies.filter((candidate) => candidate.id !== bodyId)) {
      const combine = (operation: 'join' | 'cut' | 'intersect') => () =>
        startCommand('combine', {
          target: thisBody(),
          tools: [bodyPick(doc, other.id)].flatMap((pick) => pick ?? []),
          operation,
        })
      out.push({
        id: `join-${other.id}`,
        label: `Combine: Join ${other.name}`,
        hint: 'Fuses the two into one body',
        run: combine('join'),
      })
      out.push({
        id: `cut-${other.id}`,
        label: `Combine: Cut ${other.name}`,
        hint: 'Cuts it away from this body, like a cookie cutter',
        run: combine('cut'),
      })
      out.push({
        id: `overlap-${other.id}`,
        label: `Combine: Intersect ${other.name}`,
        hint: `Keeps only the part this shares with ${other.name}`,
        run: combine('intersect'),
      })
    }

    out.push({
      id: 'move',
      label: 'Move/Copy',
      hint: 'Drag the arrows. Snaps to 1 mm',
      run: () => {
        ensureMove(bodyId)
        store.setGizmoMode('translate')
      },
    })
    out.push({
      id: 'turn',
      label: 'Rotate',
      hint: 'Drag a ring. Snaps to 15 degrees',
      run: () => {
        ensureMove(bodyId)
        store.setGizmoMode('rotate')
      },
    })

    const topOf = () => bodyBounds(useStore.getState(), bodyId)?.[5] ?? 0
    out.push({
      id: 'cut-ball',
      label: 'Sphere Cut',
      hint: 'Cuts a ball-shaped hollow centred where you clicked',
      run: () =>
        startCommand('sphere', {
          operation: 'cut',
          bodies: thisBody(),
          ...(picked ? { x: picked.point[0], y: picked.point[1] } : {}),
        }),
    })
    out.push({
      id: 'cut-box',
      label: 'Box Cut',
      hint: 'Cuts a square hollow down from the top',
      run: () =>
        startCommand('box', {
          operation: 'cut',
          bodies: thisBody(),
          plane: [
            {
              kind: 'plane',
              id: 'top',
              label: 'Top of the part',
              plane: { kind: 'named', name: 'XY', offset: topOf() },
            },
          ],
          height: -10,
          ...(picked ? { x: picked.point[0] - 10, y: picked.point[1] - 10 } : {}),
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
      label: 'Hide',
      run: () => store.updateBody(bodyId, { visible: false }),
    })
    out.push({
      id: 'delete',
      label: 'Delete',
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
        label: `Create Sketch on ${label}`,
        run: () => store.startSketch({ kind: 'named', name, offset: 0 }),
      })
    }
    out.push({
      id: 'sketch-offset',
      label: 'Offset Plane Sketch',
      hint: 'Sketches on a plane parallel to the top plane at a set height',
      prompt: { label: 'Height', initial: 20, unit: 'mm' },
      run: (offset) => store.startSketch({ kind: 'named', name: 'XY', offset }),
    })
    out.push({
      id: 'add-box',
      label: 'Box',
      hint: 'A rectangular block, no sketching needed',
      run: () => startCommand('box'),
    })
    out.push({
      id: 'add-cylinder',
      label: 'Cylinder',
      hint: 'A round post',
      run: () => startCommand('cylinder'),
    })
    out.push({
      id: 'add-sphere',
      label: 'Sphere',
      hint: 'A ball',
      run: () => startCommand('sphere'),
    })
    out.push({
      id: 'add-dome',
      label: 'Dome',
      hint: 'Half a sphere, flat side down',
      run: () => startCommand('sphere', { half: true }),
    })
    out.push({
      id: 'sketch-tilted',
      label: 'Plane at Angle Sketch',
      hint: 'Sketches on the top plane tipped over, for sloped faces and brackets',
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
      label: 'Move/Copy',
      hint: 'Drag the arrows. Snaps to 1 mm',
      run: () => store.setGizmoMode('translate'),
    })
    out.push({
      id: 'turn',
      label: 'Rotate',
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
    out.push({
      id: 'ground',
      label: occurrence.grounded ? 'Unground' : 'Ground',
      hint: occurrence.grounded
        ? 'Lets joints move this component again.'
        : 'Pins this component in place, so joints move the others.',
      run: () => setGrounded(id, !occurrence.grounded),
    })
    out.push({
      id: 'joint',
      label: 'Joint',
      hint: 'Moves one component onto a snap point of another.',
      run: () => startCommand('joint'),
    })
    out.push({
      id: 'rigid-group',
      label: 'Rigid Group',
      hint: 'Locks this component to others so they move as one.',
      run: () => startCommand('rigidGroup'),
    })

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
        label: 'Mounting Holes',
        hint: `${counted(holes.length, 'hole')}, cut right through`,
        run: () => add('holes'),
      })
      out.push({
        id: 'standoffs',
        label: 'Standoffs',
        prompt: { label: 'Height', initial: 6, unit: 'mm' },
        run: (height) => add('standoffs', height),
      })
    }
    if (catalogue && part) {
      out.push({
        id: 'enclosure',
        label: 'Enclosure',
        hint: 'A box round this part, with a lid, mounts and openings',
        run: () =>
          startCommand('enclosure', {
            parts: [occurrencePick(doc, id, selection.instanceId)].flatMap((pick) => pick ?? []),
          }),
      })
    }
    if (targetBody && part?.geometry.kind === 'board') {
      out.push({
        id: 'clips',
        label: 'Board Clips',
        hint: 'Clips along two edges, so the board snaps in without screws',
        run: () =>
          startCommand('boardClips', {
            board: [occurrencePick(doc, id, selection.instanceId)].flatMap((pick) => pick ?? []),
            body: [bodyPick(doc, targetBody)].flatMap((pick) => pick ?? []),
          }),
      })
    }
    if (targetBody && part?.connectors?.length) {
      out.push({
        id: 'ports',
        label: 'Port Cutouts',
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

  if (selection.kind === 'feature' && selection.id) {
    const feature = findFeature(doc, selection.id)
    if (feature?.kind === 'joint') {
      out.push({
        id: 'edit-joint',
        label: 'Edit Joint',
        hint: 'Change the snap points, motion, angle or offset.',
        run: () => editFeature(feature),
      })
      if (motionDofs(feature.motion).length) {
        out.push({
          id: 'drive-joint',
          label: 'Drive Joint',
          hint: 'Moves the joint to an exact position.',
          run: () => startCommand('driveJoints'),
        })
        if (!feature.locked) {
          out.push({
            id: 'animate-joint',
            label: 'Animate Joint',
            hint: 'Plays the joint through its motion. Click anywhere to stop.',
            run: () => {
              const problem = animateJoint(feature.id)
              store.setStatus(
                problem ?? 'Animating the joint. Click anywhere or press a key to stop.',
              )
            },
          })
        }
        out.push({
          id: 'lock-joint',
          label: feature.locked ? 'Unlock' : 'Lock',
          hint: feature.locked ? 'Lets the joint move again.' : 'Holds the joint where it is now.',
          run: () => {
            const problem = updateJoint(feature.id, { locked: !feature.locked })
            if (problem) store.setStatus(problem)
          },
        })
      }
    }
  }

  return raw
}

export function ObjectMenu({
  x,
  y,
  actions,
  onClose,
  avoid,
}: {
  x: number
  y: number
  actions: ObjectAction[]
  onClose: () => void
  avoid?: MenuRect | null
}) {
  return (
    <ContextMenu
      x={x}
      y={y}
      avoid={avoid}
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
