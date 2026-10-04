import { Plane, Quaternion, Raycaster, Vector2, Vector3 } from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'

type Pointer = Parameters<TransformControls['pointerDown']>[0]

export class ViewportTransformControls extends TransformControls {
  private axisRotation: {
    origin: Vector3
    worldAxis: Vector3
    axis: Vector3
    plane: Plane
    radial: Vector3
    quaternion: Quaternion
    angle: number
  } | null = null
  private rotationRay = new Raycaster()

  override pointerDown(pointer: Pointer) {
    if (this.dragging) return
    this.axisRotation = null
    super.pointerDown(pointer)
    if (!pointer || !this.object || !this.dragging || this.mode !== 'rotate') return
    if (this.axis !== 'X' && this.axis !== 'Y' && this.axis !== 'Z' && this.axis !== 'E') return
    const origin = this.object.getWorldPosition(new Vector3())
    const eye = this.camera.getWorldPosition(new Vector3()).sub(origin).normalize()
    const worldAxis =
      this.axis === 'E'
        ? eye.clone()
        : new Vector3(
            ...({ X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }[this.axis] as [
              number,
              number,
              number,
            ]),
          )
    if (this.space === 'local' && this.axis !== 'E')
      worldAxis.applyQuaternion(this.object.getWorldQuaternion(new Quaternion()))
    if (Math.abs(worldAxis.dot(eye)) < 0.15) return
    const plane = new Plane().setFromNormalAndCoplanarPoint(worldAxis, origin)
    const radial = this.rotationRadial(pointer, plane, origin)
    if (!radial) return
    const parent = this.object.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion()
    this.axisRotation = {
      origin,
      worldAxis,
      axis: worldAxis.clone().applyQuaternion(parent.invert()),
      plane,
      radial,
      quaternion: this.object.quaternion.clone(),
      angle: 0,
    }
  }

  private rotationRadial(pointer: NonNullable<Pointer>, plane: Plane, origin: Vector3) {
    this.rotationRay.setFromCamera(new Vector2(pointer.x, pointer.y), this.camera)
    const point = this.rotationRay.ray.intersectPlane(plane, new Vector3())
    if (!point) return null
    point.sub(origin)
    return point.lengthSq() > 1e-12 ? point.normalize() : null
  }

  override pointerMove(pointer: Pointer) {
    const state = this.axisRotation
    if (!state) return super.pointerMove(pointer)
    if (!pointer || pointer.button !== -1 || !this.dragging || !this.object) return
    const radial = this.rotationRadial(pointer, state.plane, state.origin)
    if (!radial) return
    state.angle += Math.atan2(
      state.worldAxis.dot(new Vector3().crossVectors(state.radial, radial)),
      state.radial.dot(radial),
    )
    state.radial.copy(radial)
    const snapped = this.rotationSnap
      ? Math.round(state.angle / this.rotationSnap) * this.rotationSnap
      : state.angle
    this.object.quaternion
      .copy(state.quaternion)
      .premultiply(new Quaternion().setFromAxisAngle(state.axis, snapped))
      .normalize()
    this.dispatchEvent({ type: 'change' })
    this.dispatchEvent({ type: 'objectChange' })
  }

  override pointerUp(pointer: Pointer) {
    super.pointerUp(pointer)
    if (!this.dragging) this.axisRotation = null
  }
}
