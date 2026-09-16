import { identityMatrix, multiplyMatrices, rotationMatrix, translationMatrix } from '../doc/model'
import type { Matrix4 } from '../doc/types'
import {
  DEGREES,
  angleAbout,
  axisVector,
  columnOf,
  compose,
  dot,
  originOf,
  rotationAbout,
  translationAlong,
} from './frames'
import type { DofSpec, JointAxis, JointMotion } from './types'

const PLANAR_AXES: Record<JointAxis, [JointAxis, JointAxis]> = {
  x: ['y', 'z'],
  y: ['z', 'x'],
  z: ['x', 'y'],
}

export function motionDofs(motion: JointMotion): DofSpec[] {
  switch (motion.kind) {
    case 'rigid':
      return []
    case 'revolute':
      return [{ name: 'rotation', kind: 'rotate', axis: motion.axis }]
    case 'slider':
      return [{ name: 'slide', kind: 'slide', axis: motion.axis }]
    case 'cylindrical':
      return [
        { name: 'rotation', kind: 'rotate', axis: motion.axis },
        { name: 'slide', kind: 'slide', axis: motion.axis },
      ]
    case 'pinSlot':
      return [
        { name: 'rotation', kind: 'rotate', axis: motion.axis },
        { name: 'slide', kind: 'slide', axis: motion.slide },
      ]
    case 'planar': {
      const [primary, secondary] = PLANAR_AXES[motion.normal]
      return [
        { name: 'primarySlide', kind: 'slide', axis: primary },
        { name: 'secondarySlide', kind: 'slide', axis: secondary },
        { name: 'rotation', kind: 'rotate', axis: motion.normal },
      ]
    }
    case 'ball':
      return [
        { name: 'pitch', kind: 'rotate', axis: 'y' },
        { name: 'yaw', kind: 'rotate', axis: 'z' },
        { name: 'roll', kind: 'rotate', axis: 'x' },
      ]
  }
}

export function motionFactorOrder(motion: JointMotion): number[] {
  switch (motion.kind) {
    case 'rigid':
      return []
    case 'revolute':
    case 'slider':
      return [0]
    case 'cylindrical':
      return [0, 1]
    case 'pinSlot':
      return [1, 0]
    case 'planar':
      return [0, 1, 2]
    case 'ball':
      return [1, 0, 2]
  }
}

export function toInternal(spec: DofSpec, value: number): number {
  return spec.kind === 'rotate' ? value * DEGREES : value
}

export function toDisplay(spec: DofSpec, value: number): number {
  return spec.kind === 'rotate' ? value / DEGREES : value
}

export function displayFactor(spec: DofSpec): number {
  return spec.kind === 'rotate' ? 1 / DEGREES : 1
}

export function dofMatrix(spec: DofSpec, value: number): Matrix4 {
  const axis = axisVector(spec.axis)
  return spec.kind === 'rotate' ? rotationAbout(axis, value) : translationAlong(axis, value)
}

export function motionMatrix(motion: JointMotion, internalValues: ArrayLike<number>): Matrix4 {
  const dofs = motionDofs(motion)
  let matrix = identityMatrix()
  for (const index of motionFactorOrder(motion)) {
    matrix = multiplyMatrices(matrix, dofMatrix(dofs[index], internalValues[index] ?? 0))
  }
  return matrix
}

export function alignmentMatrix(joint: { flip: boolean; angle: number; offset: number }): Matrix4 {
  const flip: Matrix4 = joint.flip
    ? [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]
    : identityMatrix()
  return compose(translationMatrix([0, 0, joint.offset]), rotationMatrix('z', joint.angle), flip)
}

export function decomposeMotion(motion: JointMotion, relative: Matrix4): number[] {
  const t = originOf(relative)
  switch (motion.kind) {
    case 'rigid':
      return []
    case 'revolute':
      return [angleAbout(relative, motion.axis)]
    case 'slider':
      return [dot(t, axisVector(motion.axis))]
    case 'cylindrical':
      return [angleAbout(relative, motion.axis), dot(t, axisVector(motion.axis))]
    case 'pinSlot':
      return [angleAbout(relative, motion.axis), dot(t, axisVector(motion.slide))]
    case 'planar': {
      const [primary, secondary] = PLANAR_AXES[motion.normal]
      return [
        dot(t, axisVector(primary)),
        dot(t, axisVector(secondary)),
        angleAbout(relative, motion.normal),
      ]
    }
    case 'ball': {
      const x = columnOf(relative, 0)
      const y = columnOf(relative, 1)
      const z = columnOf(relative, 2)
      const pitch = Math.asin(Math.max(-1, Math.min(1, -x[2])))
      const yaw = Math.atan2(x[1], x[0])
      const roll = Math.atan2(y[2], z[2])
      return [pitch, yaw, roll]
    }
  }
}
