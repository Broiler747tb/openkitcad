import { findFeature } from '../../doc/model'
import { selectedBodyId, sketchTargetBody, useStore } from '../../doc/store'
import type { Feature, OkcDocument, SketchFeature } from '../../doc/types'
import {
  bodyPick,
  elementPick,
  featurePick,
  jointSnapPick,
  occurrencePick,
  sketchPick,
} from './picks'
import { useCommand, type CommandStart } from './session'
import { openMotionStudy } from '../MotionStudy'
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
import {
  asBuiltJointCommand,
  driveJointsCommand,
  jointCommand,
  jointOriginCommand,
  motionLinkCommand,
  rigidGroupCommand,
} from './specs/assemble'
import { motionDofs } from '../../assembly/motion'
import { getMeshData } from '../../doc/meshData'
import { decodeMesh } from '../../mesh/blob'
import { meshBounds, triangleCount } from '../../mesh/types'
import {
  meshCombineCommand,
  meshConvertCommand,
  meshInsertCommand,
  meshPlaneCutCommand,
  meshReduceCommand,
  meshRemeshCommand,
  meshRepairCommand,
  meshReverseCommand,
  meshSeparateCommand,
  meshSmoothCommand,
  averageEdge,
  middleAlong,
  setPendingMeshes,
  tessellateCommand,
} from './specs/mesh'
import { expandInstances, findBody, findComponent } from '../../doc/model'
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
  joint: spec(jointCommand),
  asBuiltJoint: spec(asBuiltJointCommand),
  rigidGroup: spec(rigidGroupCommand),
  motionLink: spec(motionLinkCommand),
  driveJoints: spec(driveJointsCommand),
  jointOrigin: spec(jointOriginCommand),
  meshInsert: spec(meshInsertCommand),
  tessellate: spec(tessellateCommand),
  meshRepair: spec(meshRepairCommand),
  meshReduce: spec(meshReduceCommand),
  meshRemesh: spec(meshRemeshCommand),
  meshSmooth: spec(meshSmoothCommand),
  meshReverse: spec(meshReverseCommand),
  meshPlaneCut: spec(meshPlaneCutCommand),
  meshSeparate: spec(meshSeparateCommand),
  meshCombine: spec(meshCombineCommand),
  meshConvert: spec(meshConvertCommand),
}

function pathPick(doc: OkcDocument, path: string[]): SelectionPick | null {
  if (path.length) return occurrencePick(doc, path[path.length - 1])
  const body = findComponent(doc, doc.rootComponentId)?.bodies[0]
  return body ? bodyPick(doc, body.id) : null
}

function selectedJoint(doc: OkcDocument): SelectionPick[] {
  const selection = useStore.getState().selection
  if (selection.kind !== 'feature' || !selection.id) return []
  const feature = findFeature(doc, selection.id)
  return feature?.kind === 'joint' ? [featurePick(doc, feature.id)!] : []
}

function selectedOccurrence(doc: OkcDocument): SelectionPick[] {
  const selection = useStore.getState().selection
  if (selection.kind !== 'occurrence' || !selection.id) return []
  const pick = occurrencePick(doc, selection.id, selection.instanceId)
  return pick ? [pick] : []
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
    case 'asBuiltJoint':
      return { initial: { one: selectedOccurrence(doc) } }
    case 'meshPlaneCut':
      return {
        initial: { body: bodies, ...(bodyId ? { offset: middleAlong(bodyId, 'XY') } : {}) },
      }
    case 'meshRemesh': {
      const edge = bodyId ? averageEdge(bodyId) : null
      return { initial: { body: bodies, ...(edge ? { edgeLength: edge } : {}) } }
    }
    case 'tessellate':
    case 'meshRepair':
    case 'meshReduce':
    case 'meshSmooth':
    case 'meshSeparate':
    case 'meshConvert':
      return { initial: { body: bodies } }
    case 'meshReverse':
      return { initial: { bodies } }
    case 'meshCombine':
      return { initial: { target: bodies } }
    case 'rigidGroup':
      return { initial: { members: selectedOccurrence(doc) } }
    case 'motionLink':
      return { initial: { a: selectedJoint(doc) } }
    case 'driveJoints': {
      const joint = selectedJoint(doc)
      const feature = joint[0] ? findFeature(doc, joint[0].id) : undefined
      const current =
        feature?.kind === 'joint'
          ? Object.fromEntries(
              motionDofs(feature.motion).map((dof, index) => [
                dof.name,
                feature.values[index] ?? 0,
              ]),
            )
          : {}
      return { initial: { joint, ...current } }
    }
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
    case 'joint': {
      if (feature.asBuilt) {
        const one = pathPick(doc, feature.one.occurrencePath)
        const two = pathPick(doc, feature.two.occurrencePath)
        return [
          COMMANDS.asBuiltJoint,
          {
            initial: {
              one: one ? [one] : [],
              two: two ? [two] : [],
              position: [jointSnapPick(doc, feature.one)],
              motion: feature.motion.kind,
            },
          },
        ]
      }
      return [
        COMMANDS.joint,
        {
          initial: {
            one: [jointSnapPick(doc, feature.one)],
            two: [jointSnapPick(doc, feature.two)],
            motion: feature.motion.kind,
            angle: feature.angle,
            offset: feature.offset,
            flip: feature.flip,
          },
        },
      ]
    }
    case 'meshInsert': {
      const data = getMeshData(feature.dataId)
      if (!data) return null
      const mesh = decodeMesh(data)
      const { min, max } = meshBounds(mesh)
      setPendingMeshes([
        {
          name: findBody(doc, feature.bodyId)?.body.name ?? 'Mesh',
          dataId: feature.dataId,
          min,
          max,
          triangles: triangleCount(mesh),
        },
      ])
      return [
        COMMANDS.meshInsert,
        {
          initial: {
            unit: feature.unit,
            yUp: feature.yUp,
            centre: feature.centre,
            ground: feature.ground,
          },
        },
      ]
    }
    case 'tessellate':
      return [
        COMMANDS.tessellate,
        {
          initial: {
            body: bodyPicks([feature.sourceBodyId]),
            refinement: feature.refinement,
          },
          ids: { mesh: feature.bodyId },
        },
      ]
    case 'meshRepair':
      return [
        COMMANDS.meshRepair,
        { initial: { body: bodyPicks([feature.bodyId]), closeHoles: feature.closeHoles } },
      ]
    case 'meshReduce':
      return [
        COMMANDS.meshReduce,
        {
          initial: {
            body: bodyPicks([feature.bodyId]),
            method: feature.method,
            proportion: Math.round(feature.proportion * 100),
            tolerance: feature.tolerance,
            count: feature.count,
          },
        },
      ]
    case 'meshRemesh':
      return [
        COMMANDS.meshRemesh,
        {
          initial: {
            body: bodyPicks([feature.bodyId]),
            edgeLength: feature.edgeLength,
            preserveSharp: feature.preserveSharp,
          },
        },
      ]
    case 'meshSmooth':
      return [
        COMMANDS.meshSmooth,
        {
          initial: {
            body: bodyPicks([feature.bodyId]),
            strength: Math.round(feature.strength * 100),
            iterations: feature.iterations,
          },
        },
      ]
    case 'meshReverse':
      return [COMMANDS.meshReverse, { initial: { bodies: bodyPicks(feature.bodyIds) } }]
    case 'meshPlaneCut': {
      const named = feature.plane.kind === 'named' ? feature.plane.name : 'XY'
      return [
        COMMANDS.meshPlaneCut,
        {
          initial: {
            body: bodyPicks([feature.bodyId]),
            plane:
              feature.plane.kind === 'face'
                ? planeValues(doc, { ...feature.plane, offset: 0 })
                : [],
            origin: named,
            offset: feature.plane.offset,
            flip: feature.flip,
            fill: feature.fill,
            keep: feature.keep,
          },
        },
      ]
    }
    case 'meshSeparate':
      return [COMMANDS.meshSeparate, { initial: { body: bodyPicks([feature.bodyId]) } }]
    case 'meshCombine':
      return [
        COMMANDS.meshCombine,
        {
          initial: {
            target: bodyPicks([feature.bodyId]),
            tools: bodyPicks(feature.toolBodyIds),
          },
        },
      ]
    case 'meshConvert':
      return [
        COMMANDS.meshConvert,
        { initial: { body: bodyPicks([feature.sourceBodyId]), method: feature.method } },
      ]
    case 'jointOrigin': {
      const node = expandInstances(doc).find(
        (candidate) => candidate.componentId === feature.componentId,
      )
      if (!node) return null
      return [
        COMMANDS.jointOrigin,
        {
          initial: {
            snap: [
              jointSnapPick(doc, {
                occurrencePath: node.path,
                snap: feature.snap,
                frame: feature.base,
              }),
            ],
            angle: feature.angle,
            offsetX: feature.offset[0],
            offsetY: feature.offset[1],
            offsetZ: feature.offset[2],
            flip: feature.flip,
          },
        },
      ]
    }
    case 'rigidGroup':
      return [
        COMMANDS.rigidGroup,
        {
          initial: {
            members: feature.members.flatMap((path) => pathPick(doc, path) ?? []),
          },
        },
      ]
    case 'motionLink': {
      const a = findFeature(doc, feature.a.jointId)
      const b = findFeature(doc, feature.b.jointId)
      if (a?.kind !== 'joint' || b?.kind !== 'joint') return null
      const aAmount = motionDofs(a.motion)[0]?.kind === 'rotate' ? 360 : 10
      const bAmount = Math.abs(feature.ratio) * aAmount
      return [
        COMMANDS.motionLink,
        {
          initial: {
            a: [featurePick(doc, a.id)!],
            b: [featurePick(doc, b.id)!],
            aAngle: aAmount,
            aDistance: aAmount,
            bAngle: bAmount,
            bDistance: bAmount,
            reverse: feature.ratio < 0,
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
  return feature.kind === 'motionStudy' || !!editOptions(useStore.getState().doc, feature)
}

export function editFeature(feature: Feature): boolean {
  if (feature.kind === 'motionStudy') {
    if (useStore.getState().activeSketch) useStore.getState().closeSketch()
    useCommand.getState().cancel()
    openMotionStudy(feature)
    return true
  }
  const options = editOptions(useStore.getState().doc, feature)
  if (!options) return false
  const [command, start] = options
  if (useStore.getState().activeSketch) useStore.getState().closeSketch()
  useCommand.getState().start(command, { ...start, editing: feature })
  return true
}
