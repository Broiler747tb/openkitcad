import { activeFeatures, findOccurrence, pathKey } from '../doc/model'
import type { JointFeature, OkcDocument } from '../doc/types'
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

export function solveDocument(
  doc: OkcDocument,
  options: AssemblySolveOptions & { ground?: string[][]; release?: string[][] } = {},
): AssemblySolveResult {
  const { ground, release, ...solveOptions } = options
  return solveAssembly(assemblyInput(doc, { ground, release }), solveOptions)
}
