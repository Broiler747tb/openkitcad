import { Euler, Matrix4 as ThreeMatrix4, MathUtils } from 'three'
import type { Vec3 } from '../core/math'
import type { Matrix4 } from '../doc/types'
import { multiplyMatrices, rotationMatrix } from '../doc/model'

export function moveRotation(rotation: Vec3): Matrix4 {
  return multiplyMatrices(
    rotationMatrix('z', rotation[2]),
    multiplyMatrices(rotationMatrix('y', rotation[1]), rotationMatrix('x', rotation[0])),
  )
}

export function moveAngles(matrix: Matrix4): Vec3 {
  const angles = new Euler().setFromRotationMatrix(new ThreeMatrix4().fromArray(matrix), 'ZYX')
  return [angles.x, angles.y, angles.z].map(MathUtils.radToDeg) as Vec3
}
