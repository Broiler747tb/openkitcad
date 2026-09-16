import { findFeature } from '../../doc/model'
import { selectedBodyId, sketchTargetBody, useStore } from '../../doc/store'
import type { Feature, OkcDocument, SketchFeature } from '../../doc/types'
import { bodyPick, elementPick, sketchPick } from './picks'
import { useCommand, type CommandStart } from './session'
import {
  chamferCommand,
  combineCommand,
  filletCommand,
  moveCommand,
  shellCommand,
  shellEditCommand,
} from './specs/modify'
import { holeCommand, pointOnFace, ventCommand } from './specs/placed'
import { boxCommand, cylinderCommand, sphereCommand } from './specs/primitives'
import { operationValues, planeValues, profilePicksOf, resultIds } from './specs/shared'
import { extrudeCommand, revolveCommand } from './specs/sketchBased'
import type { AnyCommandSpec, SelectionPick } from './types'

const spec = (command: unknown) => command as AnyCommandSpec

export const COMMANDS: Readonly<Record<string, AnyCommandSpec>> = {
  extrude: spec(extrudeCommand),
  revolve: spec(revolveCommand),
  box: spec(boxCommand),
  cylinder: spec(cylinderCommand),
  sphere: spec(sphereCommand),
  fillet: spec(filletCommand),
  chamfer: spec(chamferCommand),
  shell: spec(shellCommand),
  hollow: spec(shellCommand),
  combine: spec(combineCommand),
  move: spec(moveCommand),
  hole: spec(holeCommand),
  vent: spec(ventCommand),
}

function selectedSketch(doc: OkcDocument): SketchFeature | null {
  const state = useStore.getState()
  const id =
    state.activeSketch?.featureId ??
    (state.selection.kind === 'feature' ? state.selection.id : undefined)
  const feature = id ? findFeature(doc, id) : undefined
  return feature?.kind === 'sketch' ? feature : null
}

function selectedElements(doc: OkcDocument, kind: 'face' | 'edge'): SelectionPick[] {
  return useStore
    .getState()
    .subSelection.filter((pick) => pick.kind === kind && pick.name)
    .flatMap(
      (pick) =>
        elementPick(
          doc,
          { bodyId: pick.bodyId, kind, name: pick.name },
          pick.instanceId,
          pick.normal ? { point: pick.point, normal: pick.normal } : undefined,
        ) ?? [],
    )
}

function startOptions(id: string): CommandStart {
  const state = useStore.getState()
  const doc = state.doc
  const bodyId = selectedBodyId(state)
  const body = bodyId ? bodyPick(doc, bodyId, state.selection.instanceId) : null
  const bodies = body ? [body] : []
  const faces = selectedElements(doc, 'face')
  switch (id) {
    case 'extrude':
    case 'revolve': {
      const sketch = selectedSketch(doc)
      const target = sketch ? sketchTargetBody(doc, sketch) : undefined
      const targetPick = target ? bodyPick(doc, target) : null
      return {
        initial: {
          profile: sketch ? [sketchPick(doc, sketch.id)!] : [],
          operation: targetPick ? 'join' : 'newBody',
          bodies: targetPick ? [targetPick] : [],
        },
      }
    }
    case 'fillet':
    case 'chamfer': {
      const edges = selectedElements(doc, 'edge')
      return { initial: { edges: edges.length ? edges : bodies } }
    }
    case 'shell':
    case 'hollow':
      return { initial: { faces } }
    case 'combine':
      return { initial: { target: bodies } }
    case 'move':
      return { initial: { bodies } }
    case 'box':
    case 'cylinder':
    case 'sphere':
      return { initial: { plane: faces.slice(0, 1) } }
    case 'hole':
      return { initial: { face: faces.slice(0, 1), ...(faces[0] ? pointOnFace(faces[0]) : {}) } }
    case 'vent':
      return { initial: { face: faces.slice(0, 1) } }
  }
  return {}
}

export function startCommand(id: string, initial?: CommandStart['initial']): boolean {
  const command = COMMANDS[id]
  if (!command) return false
  const options = startOptions(id)
  if (useStore.getState().activeSketch) useStore.getState().closeSketch()
  useCommand.getState().start(command, { ...options, initial: { ...options.initial, ...initial } })
  return true
}

function editOptions(doc: OkcDocument, feature: Feature): [AnyCommandSpec, CommandStart] | null {
  const bodyPicks = (ids: readonly string[]) => ids.flatMap((id) => bodyPick(doc, id) ?? [])
  switch (feature.kind) {
    case 'extrude':
    case 'revolve': {
      const shared = {
        profile: profilePicksOf(doc, feature.sketchId, feature.profiles),
        ...operationValues(doc, feature.result),
      }
      const initial =
        feature.kind === 'extrude'
          ? {
              ...shared,
              direction: feature.symmetric ? 'symmetric' : 'one',
              distance: feature.distance,
              flip: feature.reverse,
            }
          : { ...shared, axis: feature.axis, angle: feature.angle }
      return [COMMANDS[feature.kind], { initial, ids: resultIds(feature.result) }]
    }
    case 'box':
      return [
        COMMANDS.box,
        {
          initial: {
            plane: planeValues(doc, feature.plane),
            x: feature.origin[0],
            y: feature.origin[1],
            length: feature.width,
            width: feature.depth,
            height: feature.height,
            ...operationValues(doc, feature.result),
          },
          ids: resultIds(feature.result),
        },
      ]
    case 'cylinder':
    case 'sphere':
      return [
        COMMANDS[feature.kind],
        {
          initial: {
            plane: planeValues(doc, feature.plane),
            x: feature.centre[0],
            y: feature.centre[1],
            diameter: feature.radius * 2,
            ...(feature.kind === 'cylinder' ? { height: feature.height } : { half: feature.half }),
            ...operationValues(doc, feature.result),
          },
          ids: resultIds(feature.result),
        },
      ]
    case 'fillet':
    case 'chamfer': {
      const edges = feature.edges.length
        ? feature.edges.flatMap((ref) => elementPick(doc, ref) ?? [])
        : bodyPicks([feature.bodyId])
      return [
        COMMANDS[feature.kind],
        {
          initial: {
            edges,
            ...(feature.kind === 'fillet'
              ? { radius: feature.radius }
              : { distance: feature.distance }),
          },
        },
      ]
    }
    case 'shell':
      return [
        spec(shellEditCommand),
        {
          initial: {
            faces: feature.openFaces.flatMap((ref) => elementPick(doc, ref) ?? []),
            thickness: feature.thickness,
          },
        },
      ]
    case 'combine':
      return [
        COMMANDS.combine,
        {
          initial: {
            target: bodyPicks([feature.bodyId]),
            tools: bodyPicks(feature.toolBodyIds),
            operation: feature.operation,
            keepTools: feature.keepTools,
          },
        },
      ]
    case 'move':
      return [
        COMMANDS.move,
        {
          initial: {
            bodies: bodyPicks(feature.bodyIds),
            dx: feature.offset[0],
            dy: feature.offset[1],
            dz: feature.offset[2],
            rx: feature.rotation[0],
            ry: feature.rotation[1],
            rz: feature.rotation[2],
          },
        },
      ]
    case 'hole': {
      if (feature.plane.kind !== 'face' || feature.source.kind !== 'explicit') return null
      if (feature.source.positions.length !== 1) return null
      const [x, y] = feature.source.positions[0]
      return [
        COMMANDS.hole,
        {
          initial: {
            face: planeValues(doc, feature.plane),
            x,
            y,
            style: feature.style === 'tapped' ? 'simple' : feature.style,
            diameter: feature.diameter,
            extent: feature.depth === 'through' ? 'through' : 'distance',
            ...(feature.depth === 'through' ? {} : { depth: feature.depth }),
            ...(feature.counterboreDiameter ? { headDiameter: feature.counterboreDiameter } : {}),
            ...(feature.counterboreDepth ? { headDepth: feature.counterboreDepth } : {}),
            ...(feature.countersinkAngle ? { angle: feature.countersinkAngle } : {}),
          },
        },
      ]
    }
    case 'vent':
      if (feature.plane.kind !== 'face') return null
      return [
        COMMANDS.vent,
        {
          initial: {
            face: planeValues(doc, feature.plane),
            shape: feature.shape,
            size: feature.size,
            spacing: feature.spacing,
            margin: feature.margin,
            extent: feature.depth === 'through' ? 'through' : 'distance',
            ...(feature.depth === 'through' ? {} : { depth: feature.depth }),
          },
        },
      ]
  }
  return null
}

export function canEditInPanel(feature: Feature): boolean {
  return !!editOptions(useStore.getState().doc, feature)
}

export function editFeature(feature: Feature): boolean {
  const options = editOptions(useStore.getState().doc, feature)
  if (!options) return false
  const [command, start] = options
  if (useStore.getState().activeSketch) useStore.getState().closeSketch()
  useCommand.getState().start(command, { ...start, editing: feature })
  return true
}
