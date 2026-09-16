import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { CataloguePart } from '../../catalogue'
import { createLook, disposeLook, lookKey, lookPrototype } from '../../viewport/partLook'

export interface PreviewView {
  yaw: number
  pitch: number
}

interface Stage {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  env: THREE.Texture
}

let stage: Stage | null | undefined

function getStage(): Stage | null {
  if (stage !== undefined) return stage
  try {
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    })
    renderer.setPixelRatio(1)
    renderer.setClearColor(0x000000, 0)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 5000)
    camera.up.set(0, 0, 1)
    scene.add(camera)
    camera.add(new THREE.HemisphereLight(0xf4f7fb, 0x4a5058, 1.3))
    const key = new THREE.DirectionalLight(0xffffff, 1.9)
    key.position.set(60, 90, 40)
    camera.add(key)
    const fill = new THREE.DirectionalLight(0x9fb4cc, 0.6)
    fill.position.set(-90, -20, 30)
    camera.add(fill)
    const generator = new THREE.PMREMGenerator(renderer)
    const env = generator.fromScene(new RoomEnvironment(), 0.04).texture
    generator.dispose()
    stage = { renderer, scene, camera, env }
  } catch {
    stage = null
  }
  return stage
}

export function defaultView(part: CataloguePart): PreviewView {
  switch (part.geometry.kind) {
    case 'connector':
      return { yaw: 1.15, pitch: 0.42 }
    case 'screw':
    case 'insert':
    case 'standoff':
      return { yaw: -2.2, pitch: 0.38 }
    case 'bearing':
      return { yaw: -2.2, pitch: 0.85 }
    case 'extrusion':
      return { yaw: -2.6, pitch: 0.5 }
    default:
      return { yaw: -2.15, pitch: 0.78 }
  }
}

export function lookRadius(part: CataloguePart): number {
  return lookPrototype(part).box.getBoundingSphere(new THREE.Sphere()).radius
}

export function renderPart(
  part: CataloguePart,
  width: number,
  height: number,
  view: PreviewView = defaultView(part),
  radius = 0,
): HTMLCanvasElement | null {
  const current = getStage()
  if (!current || width < 1 || height < 1) return null
  const { renderer, scene, camera, env } = current
  const prototype = lookPrototype(part)
  if (prototype.box.isEmpty()) return null
  const look = createLook(prototype, { envMap: env, edgeColour: 0x1d2126 })
  scene.add(look.group)
  const sphere = prototype.box.getBoundingSphere(new THREE.Sphere())
  const aspect = width / height
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
  const tanH = tanV * aspect
  const pitch = THREE.MathUtils.clamp(view.pitch, -1.45, 1.45)
  const direction = new THREE.Vector3(
    Math.cos(pitch) * Math.cos(view.yaw),
    Math.cos(pitch) * Math.sin(view.yaw),
    Math.sin(pitch),
  )
  camera.aspect = aspect
  camera.position.copy(sphere.center).add(direction)
  camera.lookAt(sphere.center)
  camera.updateMatrixWorld()
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
  const { min, max } = prototype.box
  const margin = 0.9
  let distance = radius > 0 ? (radius / Math.sin(Math.atan(Math.min(tanV, tanH)))) * 0.8 : 0
  for (const x of [min.x, max.x])
    for (const y of [min.y, max.y])
      for (const z of [min.z, max.z]) {
        const offset = new THREE.Vector3(x, y, z).sub(sphere.center)
        const depth = offset.dot(direction)
        distance = Math.max(
          distance,
          depth + Math.abs(offset.dot(right)) / (margin * tanH),
          depth + Math.abs(offset.dot(up)) / (margin * tanV),
        )
      }
  camera.position.copy(sphere.center).addScaledVector(direction, distance)
  camera.near = Math.max(0.05, distance - sphere.radius * 2)
  camera.far = distance + sphere.radius * 2
  camera.lookAt(sphere.center)
  camera.updateProjectionMatrix()
  renderer.setSize(width, height, false)
  renderer.render(scene, camera)
  scene.remove(look.group)
  disposeLook(look)
  return renderer.domElement
}

const urls = new Map<string, string>()
const waiting = new Map<
  string,
  { part: CataloguePart; width: number; height: number; listeners: Set<(url: string) => void> }
>()
let pending = false

function pump() {
  pending = false
  const started = performance.now()
  for (const [key, job] of waiting) {
    waiting.delete(key)
    const canvas = renderPart(job.part, job.width, job.height)
    const url = canvas ? canvas.toDataURL('image/png') : ''
    urls.set(key, url)
    for (const listener of job.listeners) listener(url)
    if (performance.now() - started > 24) break
  }
  if (waiting.size) schedule()
}

function schedule() {
  if (pending) return
  pending = true
  setTimeout(pump, 16)
}

export function usePartThumbnail(
  part: CataloguePart,
  width: number,
  height: number,
): string | null {
  const key = `${lookKey(part)}@${width}x${height}`
  const [url, setUrl] = useState<string | null>(() => urls.get(key) || null)
  useEffect(() => {
    const known = urls.get(key)
    if (known !== undefined) {
      setUrl(known || null)
      return
    }
    setUrl(null)
    const listener = (value: string) => setUrl(value || null)
    const job = waiting.get(key) ?? { part, width, height, listeners: new Set() }
    job.listeners.add(listener)
    waiting.set(key, job)
    schedule()
    return () => {
      job.listeners.delete(listener)
      if (!job.listeners.size) waiting.delete(key)
    }
  }, [key])
  return url
}
