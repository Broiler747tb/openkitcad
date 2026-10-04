import * as THREE from 'three'

export function styleTransformControls(helper: THREE.Object3D) {
  const gizmo = helper.children.find((child) => 'gizmo' in child && 'picker' in child) as
    | (THREE.Object3D & {
        gizmo: Record<string, THREE.Group>
        picker: Record<string, THREE.Group>
      })
    | undefined
  if (!gizmo) return
  const visible = gizmo.gizmo.translate
  const picker = gizmo.picker.translate
  for (const group of [visible, picker]) {
    for (const child of [...group.children]) {
      group.remove(child)
      ;(child as THREE.Mesh).geometry.dispose()
    }
  }
  const material = (colour: number, opacity = 1) =>
    new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
  const add = (
    group: THREE.Group,
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.MeshBasicMaterial,
  ) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.renderOrder = 30
    group.add(mesh)
  }
  const axes: Array<[string, THREE.Vector3, number]> = [
    ['X', new THREE.Vector3(1, 0, 0), 0xe34c45],
    ['Y', new THREE.Vector3(0, 1, 0), 0x279e72],
    ['Z', new THREE.Vector3(0, 0, 1), 0x347fe5],
  ]
  for (const [name, axis, colour] of axes) {
    const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis)
    const orient = (geometry: THREE.BufferGeometry) =>
      geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(turn))
    add(
      visible,
      name,
      orient(new THREE.CylinderGeometry(0.015, 0.015, 0.69, 12).translate(0, 0.425, 0)),
      material(colour),
    )
    add(
      visible,
      name,
      orient(new THREE.ConeGeometry(0.065, 0.23, 24).translate(0, 0.885, 0)),
      material(colour),
    )
    add(
      picker,
      name,
      orient(new THREE.CylinderGeometry(0.095, 0.095, 0.96, 12).translate(0, 0.61, 0)),
      material(colour),
    )
  }
  for (const [name, position, normal, colour] of [
    ['XY', [0.27, 0.27, 0], [0, 0, 1], 0x347fe5],
    ['YZ', [0, 0.27, 0.27], [1, 0, 0], 0xe34c45],
    ['XZ', [0.27, 0, 0.27], [0, 1, 0], 0x279e72],
  ] as Array<[string, [number, number, number], [number, number, number], number]>) {
    const turn = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(...normal),
    )
    const geometry = () =>
      new THREE.BoxGeometry(0.16, 0.16, 0.008)
        .applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(turn))
        .translate(...position)
    add(visible, name, geometry(), material(colour, 0.24))
    add(picker, name, geometry(), material(colour))
  }
  add(visible, 'XYZ', new THREE.BoxGeometry(0.085, 0.085, 0.085), material(0x7c8a9b))
  add(picker, 'XYZ', new THREE.BoxGeometry(0.17, 0.17, 0.17), material(0x7c8a9b))
  const rings = gizmo.gizmo.rotate
  const ringPicker = gizmo.picker.rotate
  for (const group of [rings, ringPicker]) {
    for (const child of [...group.children]) {
      group.remove(child)
      ;(child as THREE.Mesh).geometry.dispose()
    }
  }
  for (const [name, axis, colour] of axes) {
    const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis)
    const ring = (thickness: number) =>
      new THREE.TorusGeometry(0.84, thickness, 12, 128).applyMatrix4(
        new THREE.Matrix4().makeRotationFromQuaternion(turn),
      )
    add(rings, name, ring(0.018), material(colour))
    add(ringPicker, name, ring(0.085), material(colour))
  }
  add(rings, 'E', new THREE.TorusGeometry(1.06, 0.012, 12, 128), material(0xb6c3cf, 0.65))
  add(ringPicker, 'E', new THREE.TorusGeometry(1.06, 0.065, 12, 128), material(0xb6c3cf))
}
