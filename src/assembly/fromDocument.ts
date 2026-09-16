import {
  activeFeatures,
  findFeature,
  findOccurrence,
  multiplyMatrices,
  pathKey,
  rotationMatrix,
  translationMatrix,
} from '../doc/model'
import type { JointFeature, JointOriginFeature, Matrix4, OkcDocument } from '../doc/types'
import { assemblyInputFromDocument, occurrenceUpdatesFromSolve } from './document'
import { solveAssembly } from './solve'
import type {
  AsBuiltJoint,
  AssemblySolveInput,
  AssemblySolveOptions,
  AssemblySolveResult,
  Joint,
  MotionLink,
  RigidGroup,
} from './types'

function jointOf(feature: JointFeature): Joint {
  return {
    id: feature.id,
    name: feature.name,
    one: {
      kind: 'geometry',
      occurrencePath: feature.one.occurrencePath,
      frame: feature.one.frame,
      snap: feature.one.snap,
    },
    two: {
      kind: 'geometry',
      occurrencePath: feature.two.occurrencePath,
      frame: feature.two.frame,
      snap: feature.two.snap,
    },
    motion: feature.motion,
    flip: !feature.flip,
    angle: feature.angle,
    offset: feature.offset,
    values: feature.values,
    limits: feature.limits,
    locked: feature.locked,
  }
}

function asBuiltOf(feature: JointFeature): AsBuiltJoint {
  return {
    id: feature.id,
    name: feature.name,
    one: feature.one.occurrencePath,
    two: feature.two.occurrencePath,
    frame: feature.one.frame,
    twoFrame: feature.two.frame,
    snap: feature.one.snap,
    motion: feature.motion,
    values: feature.values,
    limits: feature.limits,
    locked: feature.locked,
  }
}

export function assemblyInput(
  doc: OkcDocument,
  options: { ground?: string[][]; release?: string[][] } = {},
): AssemblySolveInput {
  const joints: Joint[] = []
  const asBuiltJoints: AsBuiltJoint[] = []
  const rigidGroups: RigidGroup[] = []
  const motionLinks: MotionLink[] = []
  for (const feature of activeFeatures(doc)) {
    if (feature.kind === 'joint') {
      if (feature.asBuilt) asBuiltJoints.push(asBuiltOf(feature))
      else joints.push(jointOf(feature))
    } else if (feature.kind === 'rigidGroup') {
      rigidGroups.push({ id: feature.id, name: feature.name, members: feature.members })
    } else if (feature.kind === 'motionLink') {
      motionLinks.push({
        id: feature.id,
        name: feature.name,
        a: feature.a,
        b: feature.b,
        ratio: feature.ratio,
        offset: feature.offset,
      })
    }
  }
  const input = assemblyInputFromDocument(doc, {
    joints,
    asBuiltJoints,
    rigidGroups,
    motionLinks,
    origins: [],
    contactSets: [],
  })
  const grounded = new Set((options.ground ?? []).map(pathKey))
  const released = new Set((options.release ?? []).map(pathKey))
  return {
    ...input,
    occurrences: input.occurrences.map((occurrence) => {
      const key = pathKey(occurrence.path)
      if (released.has(key) && occurrence.path.length) return { ...occurrence, grounded: false }
      if (grounded.has(key)) return { ...occurrence, grounded: true }
      return occurrence
    }),
  }
}

export function applyAssemblyResult(doc: OkcDocument, result: AssemblySolveResult): string[] {
  const { transforms, divergent } = occurrenceUpdatesFromSolve(doc, result)
  for (const [id, transform] of Object.entries(transforms)) {
    const occurrence = findOccurrence(doc, id)
    if (occurrence) occurrence.transform = transform
  }
  for (const feature of doc.timeline) {
    if (feature.kind !== 'joint') continue
    const values = result.jointValues[feature.id]
    if (values) feature.values = [...values]
  }
  return divergent
}

const FLIP: Matrix4 = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]

export function originFrame(
  origin: Pick<JointOriginFeature, 'base' | 'offset' | 'angle' | 'flip'>,
): Matrix4 {
  const placed = multiplyMatrices(
    multiplyMatrices(origin.base, translationMatrix(origin.offset)),
    rotationMatrix('z', origin.angle),
  )
  return origin.flip ? multiplyMatrices(placed, FLIP) : placed
}

export function followOrigins(doc: OkcDocument): boolean {
  let changed = false
  for (const feature of doc.timeline) {
    if (feature.kind === 'jointOrigin' && feature.snap.originId) {
      const parent = findFeature(doc, feature.snap.originId)
      if (parent?.kind === 'jointOrigin') {
        const base = originFrame(parent)
        if (base.some((value, index) => Math.abs(value - feature.base[index]) > 1e-9)) {
          feature.base = base
          changed = true
        }
      }
    }
    if (feature.kind !== 'joint') continue
    for (const side of [feature.one, feature.two]) {
      if (!side.snap.originId) continue
      const origin = findFeature(doc, side.snap.originId)
      if (origin?.kind !== 'jointOrigin') continue
      const frame = originFrame(origin)
      if (frame.some((value, index) => Math.abs(value - side.frame[index]) > 1e-9)) {
        side.frame = frame
        changed = true
      }
    }
  }
  return changed
}

export function jointedPaths(doc: OkcDocument): Set<string> {
  const keys = new Set<string>()
  for (const feature of activeFeatures(doc)) {
    if (feature.kind === 'joint') {
      keys.add(pathKey(feature.one.occurrencePath))
      keys.add(pathKey(feature.two.occurrencePath))
    } else if (feature.kind === 'rigidGroup') {
      for (const path of feature.members) keys.add(pathKey(path))
    }
  }
  return keys
}

export function solveDocument(
  doc: OkcDocument,
  options: AssemblySolveOptions & { ground?: string[][]; release?: string[][] } = {},
): AssemblySolveResult {
  const { ground, release, ...solveOptions } = options
  return solveAssembly(assemblyInput(doc, { ground, release }), solveOptions)
}
