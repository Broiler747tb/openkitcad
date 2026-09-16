import { findFeature } from '../doc/model'
import type { MotionStudyFeature, MotionStudyTrack, OkcDocument } from '../doc/types'
import { applyAssemblyResult, solveDocument } from './fromDocument'
import { motionDofs } from './motion'
import type { JointDrive } from './types'

export function trackValue(track: MotionStudyTrack, step: number, fallback: number): number {
  const keys = [...track.keys].sort((a, b) => a.step - b.step)
  if (!keys.length) return fallback
  if (step <= keys[0].step) return keys[0].value
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]
    const b = keys[i]
    if (step > b.step) continue
    const t = b.step === a.step ? 1 : (step - a.step) / (b.step - a.step)
    return a.value + (b.value - a.value) * t
  }
  return keys[keys.length - 1].value
}

export function studyDrives(
  doc: OkcDocument,
  study: Pick<MotionStudyFeature, 'tracks'>,
  step: number,
): JointDrive[] {
  return study.tracks.flatMap((track) => {
    const joint = findFeature(doc, track.jointId)
    if (joint?.kind !== 'joint' || joint.locked) return []
    if (!motionDofs(joint.motion)[track.dof]) return []
    return [
      {
        jointId: joint.id,
        dof: track.dof,
        value: trackValue(track, step, joint.values[track.dof] ?? 0),
      },
    ]
  })
}

export function poseStudy(
  doc: OkcDocument,
  study: Pick<MotionStudyFeature, 'tracks'>,
  step: number,
): boolean {
  const drive = studyDrives(doc, study, step)
  if (!drive.length) return false
  const result = solveDocument(doc, { drive })
  applyAssemblyResult(doc, result)
  return result.conflictingJoints.length === 0
}
