import * as THREE from 'three'
import type { BodyMesh, Instance } from '../kernel/types'

export function renderSnapshot(instances: Instance[], meshes: BodyMesh[], view: unknown) {
  const directions: Record<string, number[]> = {
    iso: [1, -1, 1],
    top: [0, 0, 1],
    bottom: [0, 0, -1],
    front: [0, -1, 0],
    back: [0, 1, 0],
    left: [-1, 0, 0],
    right: [1, 0, 0],
  }
  if (typeof view !== 'string' || !directions[view])
    throw new Error('View must be iso, top, bottom, front, back, left or right.')
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#18212b')
  const group = new THREE.Group()
  scene.add(group, new THREE.HemisphereLight('#ffffff', '#384d65', 2))
  const light = new THREE.DirectionalLight('#ffffff', 3)
  light.position.set(1, -2, 3)
  scene.add(light)
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  try {
    for (const instance of instances.filter((instance) => instance.visible && !instance.negative)) {
      const source = meshes.find((mesh) => mesh.key === instance.meshKey)
      if (!source) continue
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(source.mesh.vertices, 3))
      geometry.setAttribute('normal', new THREE.BufferAttribute(source.mesh.normals, 3))
      geometry.setIndex(new THREE.BufferAttribute(source.mesh.triangles, 1))
      const material = new THREE.MeshStandardMaterial({
        color: source.colour,
        roughness: 0.6,
        metalness: 0.1,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.matrix.fromArray(instance.matrix)
      mesh.matrixAutoUpdate = false
      group.add(mesh)
      geometries.push(geometry)
      materials.push(material)
    }
    group.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(group)
    if (bounds.isEmpty()) throw new Error('There is no visible geometry to capture.')
    const centre = bounds.getCenter(new THREE.Vector3())
    const radius = bounds.getSize(new THREE.Vector3()).length() / 2 || 1
    const camera = new THREE.OrthographicCamera(
      -radius * 1.25,
      radius * 1.25,
      radius,
      -radius,
      0.01,
      radius * 20,
    )
    camera.up.set(0, 0, 1)
    if (view === 'top' || view === 'bottom') camera.up.set(0, 1, 0)
    camera.position
      .copy(centre)
      .add(
        new THREE.Vector3(...(directions[view] as [number, number, number]))
          .normalize()
          .multiplyScalar(radius * 5),
      )
    camera.lookAt(centre)
    renderer.setSize(1000, 800, false)
    renderer.render(scene, camera)
    return {
      mimeType: 'image/png',
      view,
      width: 1000,
      height: 800,
      dataUrl: renderer.domElement.toDataURL('image/png'),
    }
  } finally {
    geometries.forEach((geometry) => geometry.dispose())
    materials.forEach((material) => material.dispose())
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
