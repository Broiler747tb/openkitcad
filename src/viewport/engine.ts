/**
 * The three.js side of the viewport.
 *
 * Kept out of React on purpose: scene graph updates happen far more often than
 * anything React should re-render for, and mixing the two is how CAD viewports
 * end up dropping frames while orbiting.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { FastenerGhost } from './ghosts'
import type { BodyMesh, Instance } from '../kernel/types'
import type { Matrix4 } from '../doc/types'
import type { Frame, Vec2, Vec3 } from '../core/math'
import { frameToWorld, v3 } from '../core/math'
import type { Sketch2D } from '../sketch/types'
import { usePreferences, type Preferences } from '../doc/preferences'
import { tessellate } from '../sketch/curves'
import { regionAt, type RegionResult } from '../sketch/regions'

export interface ScreenLabel {
  id: string
  text: string
  x: number
  y: number
  kind: 'dimension' | 'hint' | 'measure' | 'constraint'
}

export interface PickResult {
  instanceId: string
  kind: Instance['kind']
  bodyId: string
  path: string[]
  point: Vec3
  normal: Vec3
  localPoint: Vec3
  localNormal: Vec3
  faceId: number
  faceName: string
}

export interface SubPick {
  instanceId: string
  bodyId: string
  kind: 'face' | 'edge' | 'vertex'
  id: string
  name: string
  point: Vec3
  normal?: Vec3
  length?: number
}

export function elementKey(prefix: 'f' | 'e', name: string, id: number): string {
  return name ? `${prefix}:${name}` : `${prefix}#${id}`
}

export interface SketchOverlay {
  id: string
  frame: Frame
  curves: Vec2[][]
  construction: Vec2[][]
  regions: RegionResult
  profiles: boolean
}

export interface ProfileHit {
  sketchId: string
  key: string
  distance: number
}

export interface WorldHandle {
  id: string
  kind: 'arrow' | 'arc'
  origin: Vec3
  direction: Vec3
  length: number
  start?: Vec3
  radius?: number
}

export interface HandleScreen {
  id: string
  x: number
  y: number
}

const OVERLAY_LINE = 0x3d4b5c
const OVERLAY_CONSTRUCTION = 0x9097a0
const PROFILE_IDLE = 0xf1cf9b
const PROFILE_HOVER = 0xf0a64a
const PROFILE_PICKED = 0x4f9fe0
const PROFILE_LIFT = 0.02
const HANDLE = 0x1676c5
const HANDLE_HOT = 0x46a3ec
const HANDLE_GRAB_PX = 14

export interface GizmoPose {
  position: Vec3
  rotationXyz: Vec3
  matrix: Matrix4
}

interface ShapeGroups {
  vertices: Float32Array
  triangles: Uint32Array
  faceGroups: BodyMesh['mesh']['faceGroups']
  lines: Float32Array
  edgeGroups: BodyMesh['edges']['edgeGroups']
}

interface GeometryEntry {
  surface: THREE.BufferGeometry
  edges: THREE.BufferGeometry
  data: ShapeGroups
}

interface InstanceObject {
  mesh: THREE.Mesh
  outline: THREE.LineSegments
  instance: Instance
}

/**
 * Where the camera sits before anything else has moved it.
 *
 * Turned a quarter of a turn from the obvious front-right-above position, so
 * the model reads rotated 90 degrees anticlockwise compared with the first
 * version. Rotating the camera clockwise about the vertical axis is what makes
 * the *content* appear to turn to the left: they go opposite ways.
 */
const HOME_CAMERA: Vec3 = [-220, -180, 160]

const ACCENT = 0xff9f2e
const PREVIEW_CUT = 0xd4473d
const ACCENT_DIM = 0xc4761c
/** Pre-selection: what a click would take. */
const HOVER = 0xffd9a0
const SKETCH_LINE = 0xf2ede4
const SKETCH_TESSELLATION_MM = 0.01
const CONSTRUCTION = 0x6f7681
/** Geometry that is not yet pinned down. */
const UNDERDEFINED = 0x5aa9e6

function matchesKey(instance: Instance, key: string | null): boolean {
  return !!key && (instance.id === key || instance.bodyId === key || instance.path.includes(key))
}

export class ViewportEngine {
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private controls: OrbitControls
  private raycaster = new THREE.Raycaster()

  private solidGroup = new THREE.Group()
  private sketchGroup = new THREE.Group()
  private overlayGroup = new THREE.Group()
  private gridGroup = new THREE.Group()

  private geometries = new Map<string, GeometryEntry>()
  private objects = new Map<string, InstanceObject>()
  private highlightGroup = new THREE.Group()
  private clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)
  private sectionPlanes: THREE.Plane[] = []
  private dimmed = false
  private highlightKeys: { hovered: string | null; selected: string | null } = {
    hovered: null,
    selected: null,
  }

  private disposed = false
  labels: ScreenLabel[] = []
  onLabels: ((labels: ScreenLabel[]) => void) | null = null
  onHandleScreens: ((handles: HandleScreen[]) => void) | null = null
  private handleGroup = new THREE.Group()
  private sketchOverlayGroup = new THREE.Group()
  private sketchOverlays: SketchOverlay[] = []
  private profileMeshes = new Map<string, THREE.Mesh>()
  private profileState: { picked: ReadonlySet<string>; hovered: string | null } = {
    picked: new Set(),
    hovered: null,
  }
  private handles: WorldHandle[] = []
  private handleScreens: HandleScreen[] = []

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.localClippingEnabled = true
    this.renderer.setClearColor(0xe8eaec, 1)
    container.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 20000)
    this.camera.position.set(...HOME_CAMERA)
    this.camera.up.set(0, 0, 1)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.12
    this.controls.screenSpacePanning = true
    // Middle-drag pans rather than dollies: the wheel already zooms, and every
    // CAD package a tinkerer has touched pans on the middle button.
    this.controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: null,
    }
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN }

    // Capture before OrbitControls: its PAN handler swaps to orbit on Shift.
    this.renderer.domElement.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button === 1) this.controls.enableRotate = event.shiftKey
      },
      { capture: true },
    )

    this.scene.add(
      this.solidGroup,
      this.sketchOverlayGroup,
      this.sketchGroup,
      this.overlayGroup,
      this.gridGroup,
      this.highlightGroup,
      this.handleGroup,
    )
    this.buildLighting()
    this.buildGrid()
    this.resize()
    this.animate()
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  private buildLighting() {
    this.scene.add(new THREE.HemisphereLight(0xdfe6ef, 0x24282d, 1.5))
    const key = new THREE.DirectionalLight(0xffffff, 1.8)
    key.position.set(120, -180, 260)
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(0x9fb4cc, 0.7)
    fill.position.set(-200, 140, 90)
    this.scene.add(fill)
    const rim = new THREE.DirectionalLight(0xffc98a, 0.45)
    rim.position.set(-60, -220, -140)
    this.scene.add(rim)
  }

  private buildGrid() {
    const grid = new THREE.GridHelper(1000, 100, 0x969da5, 0xc4c9ce)
    grid.rotation.x = Math.PI / 2
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.55
    this.gridGroup.add(grid)

    // Origin axes, just long enough to orient a newcomer.
    const axes = new THREE.Group()
    const axis = (dir: Vec3, colour: number) => {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(...dir),
      ])
      return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: colour }))
    }
    axes.add(axis([40, 0, 0], 0xd4574e))
    axes.add(axis([0, 40, 0], 0x74b352))
    axes.add(axis([0, 0, 40], 0x4d8fd6))
    this.gridGroup.add(axes)
  }

  setGridPreferences(p: Preferences, frame: Frame | null) {
    for (const child of [...this.gridGroup.children]) {
      this.gridGroup.remove(child)
      child.traverse((obj) => {
        const mesh = obj as THREE.LineSegments
        if (mesh.geometry) mesh.geometry.dispose()
        if (mesh.material) {
          for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
            m.dispose()
        }
      })
    }
    this.gridGroup.position.set(0, 0, 0)
    this.gridGroup.quaternion.identity()
    if (frame) {
      this.gridGroup.position.set(...frame.origin)
      this.gridGroup.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(
          new THREE.Vector3(...frame.xDir),
          new THREE.Vector3(...frame.yDir),
          new THREE.Vector3(...frame.normal),
        ),
      )
    }
    const add = (positions: number[], colour: number, opacity: number) => {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      this.gridGroup.add(
        new THREE.LineSegments(
          geometry,
          new THREE.LineBasicMaterial({
            color: colour,
            transparent: true,
            opacity,
            depthWrite: false,
          }),
        ),
      )
    }
    if (p.gridVisible) {
      // Decimate visual lines at extreme settings, never change the snapping interval.
      const stride = Math.max(1, Math.ceil(p.gridExtent / p.gridStep / 400))
      const step = p.gridStep * stride,
        n = Math.floor(p.gridExtent / step / 2),
        half = n * step
      const minor: number[] = [],
        major: number[] = []
      for (let i = -n; i <= n; i++) {
        const at = i * step
        const lines = (i * stride) % p.majorEvery === 0 ? major : minor
        lines.push(at, -half, 0, at, half, 0, -half, at, 0, half, at, 0)
      }
      add(minor, 0xa9b4bf, p.gridOpacity)
      add(major, 0x738597, Math.min(1, p.gridOpacity + 0.2))
    }
    if (p.axesVisible) {
      const size = p.gridExtent / 2
      add([-size, 0, 0, size, 0, 0], 0xc34d44, 0.8)
      add([0, -size, 0, 0, size, 0], 0x598d46, 0.8)
    }
    this.transform?.setTranslationSnap(p.moveSnap || null)
    this.transform?.setRotationSnap(p.angleSnap ? THREE.MathUtils.degToRad(p.angleSnap) : null)
  }

  private geometryFor(source: BodyMesh): GeometryEntry {
    const existing = this.geometries.get(source.key)
    if (existing) return existing
    const surface = new THREE.BufferGeometry()
    surface.setAttribute('position', new THREE.BufferAttribute(source.mesh.vertices, 3))
    surface.setAttribute('normal', new THREE.BufferAttribute(source.mesh.normals, 3))
    surface.setIndex(new THREE.BufferAttribute(source.mesh.triangles, 1))
    surface.computeBoundingSphere()
    const edges = new THREE.BufferGeometry()
    edges.setAttribute('position', new THREE.BufferAttribute(source.edges.lines, 3))
    edges.computeBoundingSphere()
    const entry: GeometryEntry = {
      surface,
      edges,
      data: {
        vertices: source.mesh.vertices,
        triangles: source.mesh.triangles,
        faceGroups: source.mesh.faceGroups,
        lines: source.edges.lines,
        edgeGroups: source.edges.edgeGroups,
      },
    }
    this.geometries.set(source.key, entry)
    return entry
  }

  setScene(
    instances: Instance[],
    meshes: ReadonlyMap<string, BodyMesh>,
    colourOf: (instance: Instance) => string,
    showPlacements: boolean,
  ) {
    const seen = new Set<string>()
    for (const instance of instances) {
      if (!instance.visible) continue
      if (instance.kind === 'catalogue' && !showPlacements) continue
      const source = meshes.get(instance.meshKey)
      if (!source) continue
      const geometry = this.geometryFor(source)
      seen.add(instance.id)

      let entry = this.objects.get(instance.id)
      if (!entry) {
        const tool = !!instance.previewTool
        const material = new THREE.MeshStandardMaterial({
          roughness: 0.62,
          metalness: 0.08,
          clippingPlanes: this.sectionPlanes,
          side: THREE.DoubleSide,
        })
        if (tool) {
          material.transparent = true
          material.opacity = 0.42
          material.depthWrite = false
        } else {
          this.applyOpacity(material)
        }
        const mesh = new THREE.Mesh(geometry.surface, material)
        mesh.matrixAutoUpdate = false
        mesh.renderOrder = tool ? 4 : 0
        const outline = new THREE.LineSegments(
          geometry.edges,
          new THREE.LineBasicMaterial({
            color: tool ? PREVIEW_CUT : 0x1a1d21,
            transparent: true,
            opacity: tool ? 0.6 : 0.85,
            clippingPlanes: this.sectionPlanes,
          }),
        )
        outline.matrixAutoUpdate = false
        this.solidGroup.add(mesh, outline)
        entry = { mesh, outline, instance }
        this.objects.set(instance.id, entry)
      }

      entry.instance = instance
      entry.mesh.geometry = geometry.surface
      entry.outline.geometry = geometry.edges
      entry.mesh.userData = { instanceId: instance.id }
      entry.outline.userData = { instanceId: instance.id }
      entry.mesh.matrix.fromArray(instance.matrix)
      entry.outline.matrix.fromArray(instance.matrix)
      entry.mesh.matrixWorldNeedsUpdate = true
      entry.outline.matrixWorldNeedsUpdate = true
      ;(entry.mesh.material as THREE.MeshStandardMaterial).color.set(colourOf(instance))
    }

    for (const [id, entry] of [...this.objects]) {
      if (seen.has(id)) continue
      this.solidGroup.remove(entry.mesh, entry.outline)
      ;(entry.mesh.material as THREE.Material).dispose()
      ;(entry.outline.material as THREE.Material).dispose()
      this.objects.delete(id)
    }
    for (const [key, geometry] of [...this.geometries]) {
      if (meshes.has(key)) continue
      geometry.surface.dispose()
      geometry.edges.dispose()
      this.geometries.delete(key)
    }

    this.solidGroup.updateMatrixWorld(true)
    this.applyHighlight()
    this.rebuildHighlight()
  }

  setHighlight(hovered: string | null, selected: string | null) {
    this.highlightKeys = { hovered, selected }
    this.applyHighlight()
  }

  private applyHighlight() {
    const { hovered, selected } = this.highlightKeys
    for (const { mesh, instance } of this.objects.values()) {
      const material = mesh.material as THREE.MeshStandardMaterial
      if (matchesKey(instance, selected)) {
        material.emissive.setHex(ACCENT)
        material.emissiveIntensity = 0.32
      } else if (matchesKey(instance, hovered)) {
        material.emissive.setHex(ACCENT_DIM)
        material.emissiveIntensity = 0.16
      } else {
        material.emissive.setHex(0x000000)
        material.emissiveIntensity = 0
      }
    }
  }

  private applyOpacity(material: THREE.MeshStandardMaterial) {
    material.transparent = this.dimmed
    material.opacity = this.dimmed ? 0.28 : 1
    material.depthWrite = !this.dimmed
  }

  setOpacity(dimmed: boolean) {
    this.dimmed = dimmed
    for (const { mesh, instance } of this.objects.values()) {
      if (instance.previewTool) continue
      this.applyOpacity(mesh.material as THREE.MeshStandardMaterial)
    }
  }

  setSection(enabled: boolean, axis: 'x' | 'y' | 'z', position: number, flipped: boolean) {
    const normal = new THREE.Vector3(
      axis === 'x' ? 1 : 0,
      axis === 'y' ? 1 : 0,
      axis === 'z' ? 1 : 0,
    )
    if (!flipped) normal.negate()
    this.clipPlane.normal.copy(normal)
    this.clipPlane.constant = flipped ? -position : position
    this.sectionPlanes = enabled ? [this.clipPlane] : []
    for (const { mesh, outline } of this.objects.values()) {
      ;(mesh.material as THREE.Material).clippingPlanes = this.sectionPlanes
      ;(outline.material as THREE.Material).clippingPlanes = this.sectionPlanes
    }
  }

  // -------------------------------------------------------------------------
  // Sketch overlay
  // -------------------------------------------------------------------------

  clearSketch() {
    for (const child of [...this.sketchGroup.children]) {
      this.sketchGroup.remove(child)
      ;(child as any).geometry?.dispose?.()
    }
    this.labels = []
    this.onLabels?.([])
  }

  /**
   * Draw the sketch on its plane, plus the in-progress preview. Rebuilt whole
   * on every change; sketches are small and this avoids a diffing bug class.
   */
  setSketch(
    sketch: Sketch2D,
    frame: Frame,
    preview: Vec2[][] | null,
    highlight: { points: string[]; entities: string[] } = { points: [], entities: [] },
    /**
     * Geometry the solver says is still free. Drawn in a cool blue against the
     * warm white of locked-down geometry, which is the convention every other
     * parametric CAD uses and the fastest way to answer "what is still loose?".
     */
    loose: { points: string[]; entities: string[] } = { points: [], entities: [] },
  ) {
    this.clearSketch()
    const pts = new Map<string, Vec2>()
    for (const p of sketch.points) pts.set(p.id, [p.x, p.y])
    const to3 = (p: Vec2) => new THREE.Vector3(...frameToWorld(frame, p))

    const solid: THREE.Vector3[] = []
    const construction: THREE.Vector3[] = []
    const accent: THREE.Vector3[] = []
    const undefined3: THREE.Vector3[] = []

    for (const entity of sketch.entities) {
      const target = entity.construction
        ? construction
        : highlight.entities.includes(entity.id)
          ? accent
          : loose.entities.includes(entity.id)
            ? undefined3
            : solid
      const polyline = tessellate(entity, pts, SKETCH_TESSELLATION_MM)
      for (let i = 0; i + 1 < polyline.length; i++) {
        target.push(to3(polyline[i]), to3(polyline[i + 1]))
      }
    }

    const addLines = (points: THREE.Vector3[], colour: number, dashed = false) => {
      if (points.length === 0) return
      const geometry = new THREE.BufferGeometry().setFromPoints(points)
      const material = dashed
        ? new THREE.LineDashedMaterial({ color: colour, dashSize: 1.6, gapSize: 1.2 })
        : new THREE.LineBasicMaterial({ color: colour })
      const line = new THREE.LineSegments(geometry, material)
      if (dashed) line.computeLineDistances()
      line.renderOrder = 10
      ;(material as THREE.Material).depthTest = false
      this.sketchGroup.add(line)
    }

    addLines(solid, SKETCH_LINE)
    addLines(undefined3, UNDERDEFINED)
    addLines(accent, ACCENT)
    addLines(construction, CONSTRUCTION, true)

    if (preview) {
      const previewPoints: THREE.Vector3[] = []
      for (const chain of preview) {
        for (let i = 0; i + 1 < chain.length; i++) {
          previewPoints.push(to3(chain[i]), to3(chain[i + 1]))
        }
      }
      addLines(previewPoints, ACCENT, true)
    }

    // Sketch points, split by whether the solver still lets them move.
    const locked: number[] = []
    const free: number[] = []
    for (const p of sketch.points) {
      const w = frameToWorld(frame, [p.x, p.y])
      const target = loose.points.includes(p.id) ? free : locked
      target.push(w[0], w[1], w[2])
    }
    const addPoints = (coords: number[], colour: number, size: number) => {
      if (coords.length === 0) return
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3))
      const points = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: colour,
          size,
          sizeAttenuation: false,
          depthTest: false,
        }),
      )
      points.renderOrder = 11
      this.sketchGroup.add(points)
    }
    addPoints(locked, 0xffffff, 6)
    addPoints(free, UNDERDEFINED, 7)
  }

  setSketchOverlays(overlays: SketchOverlay[]) {
    for (const child of [...this.sketchOverlayGroup.children]) {
      this.sketchOverlayGroup.remove(child)
      child.traverse((object) => {
        ;(object as THREE.Mesh).geometry?.dispose?.()
        const material = (object as THREE.Mesh).material as THREE.Material | undefined
        material?.dispose?.()
      })
    }
    this.profileMeshes.clear()
    this.sketchOverlays = overlays
    for (const overlay of overlays) {
      const { frame } = overlay
      const lift = v3.scale(frame.normal, PROFILE_LIFT)
      const to3 = (p: Vec2) => new THREE.Vector3(...v3.add(frameToWorld(frame, p), lift))
      const segments = (chains: Vec2[][]) => {
        const points: THREE.Vector3[] = []
        for (const chain of chains) {
          for (let i = 0; i + 1 < chain.length; i++) points.push(to3(chain[i]), to3(chain[i + 1]))
        }
        return points
      }
      const solid = segments(overlay.curves)
      if (solid.length) {
        const line = new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(solid),
          new THREE.LineBasicMaterial({ color: OVERLAY_LINE }),
        )
        line.renderOrder = 4
        this.sketchOverlayGroup.add(line)
      }
      const dashed = segments(overlay.construction)
      if (dashed.length) {
        const line = new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(dashed),
          new THREE.LineDashedMaterial({
            color: OVERLAY_CONSTRUCTION,
            dashSize: 1.6,
            gapSize: 1.2,
          }),
        )
        line.computeLineDistances()
        line.renderOrder = 4
        this.sketchOverlayGroup.add(line)
      }
      if (!overlay.profiles) continue
      for (const region of overlay.regions.regions) {
        const contour = region.outer.polygon.map((p) => new THREE.Vector2(p[0], p[1]))
        const holes = region.holes.map((hole) =>
          [...hole.polygon].reverse().map((p) => new THREE.Vector2(p[0], p[1])),
        )
        let triangles: number[][]
        try {
          triangles = THREE.ShapeUtils.triangulateShape(contour, holes)
        } catch {
          continue
        }
        const flat = [...contour, ...holes.flat()]
        const positions = new Float32Array(flat.length * 3)
        flat.forEach((p, i) => {
          const world = to3([p.x, p.y])
          positions[i * 3] = world.x
          positions[i * 3 + 1] = world.y
          positions[i * 3 + 2] = world.z
        })
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
        geometry.setIndex(triangles.flat())
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshBasicMaterial({
            color: PROFILE_IDLE,
            transparent: true,
            opacity: 0.32,
            side: THREE.DoubleSide,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
          }),
        )
        mesh.renderOrder = 3
        const id = `${overlay.id}|${region.key}`
        mesh.userData.profileId = id
        this.profileMeshes.set(id, mesh)
        this.sketchOverlayGroup.add(mesh)
      }
    }
    this.paintProfiles()
  }

  setProfileHighlight(picked: ReadonlySet<string>, hovered: string | null) {
    this.profileState = { picked, hovered }
    this.paintProfiles()
  }

  private paintProfiles() {
    for (const [id, mesh] of this.profileMeshes) {
      const material = mesh.material as THREE.MeshBasicMaterial
      const picked = this.profileState.picked.has(id)
      const hovered = this.profileState.hovered === id
      material.color.setHex(picked ? PROFILE_PICKED : hovered ? PROFILE_HOVER : PROFILE_IDLE)
      material.opacity = picked ? 0.5 : hovered ? 0.45 : 0.32
    }
  }

  pickProfile(clientX: number, clientY: number): ProfileHit | null {
    this.raycaster.setFromCamera(this.pointerToNdc(clientX, clientY), this.camera)
    const ray = this.raycaster.ray
    let best: ProfileHit | null = null
    for (const overlay of this.sketchOverlays) {
      if (!overlay.profiles || !overlay.regions.regions.length) continue
      const normal = new THREE.Vector3(...overlay.frame.normal)
      if (Math.abs(ray.direction.dot(normal)) < 0.02) continue
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        normal,
        new THREE.Vector3(...overlay.frame.origin),
      )
      const point = new THREE.Vector3()
      if (!ray.intersectPlane(plane, point)) continue
      const d = point.clone().sub(new THREE.Vector3(...overlay.frame.origin))
      const local: Vec2 = [
        d.dot(new THREE.Vector3(...overlay.frame.xDir)),
        d.dot(new THREE.Vector3(...overlay.frame.yDir)),
      ]
      const region = regionAt(overlay.regions, local)
      if (!region) continue
      const distance = point.distanceTo(ray.origin)
      if (!best || distance < best.distance) {
        best = { sketchId: overlay.id, key: region.key, distance }
      }
    }
    if (!best) return null
    const body = this.pick(clientX, clientY)
    if (body) {
      const hitDistance = new THREE.Vector3(...body.point).distanceTo(ray.origin)
      if (hitDistance < best.distance - Math.max(0.05, best.distance * 1e-4)) return null
    }
    return best
  }

  /** Faint filled plane so the user can see what they are drawing on. */
  setSketchPlaneHint(frame: Frame | null, size = 260) {
    const existing = this.overlayGroup.getObjectByName('sketchPlane')
    if (existing) {
      this.overlayGroup.remove(existing)
      ;(existing as THREE.Mesh).geometry.dispose()
    }
    if (!frame) return
    const geometry = new THREE.PlaneGeometry(size, size)
    const material = new THREE.MeshBasicMaterial({
      color: 0x2a3038,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = 'sketchPlane'
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...frame.xDir),
      new THREE.Vector3(...frame.yDir),
      new THREE.Vector3(...frame.normal),
    )
    mesh.quaternion.setFromRotationMatrix(m)
    mesh.position.set(...frame.origin)
    mesh.renderOrder = -1
    this.overlayGroup.add(mesh)
  }

  setLabels(labels: Array<{ id: string; text: string; at: Vec3; kind: ScreenLabel['kind'] }>) {
    this.worldLabels = labels
  }
  private worldLabels: Array<{
    id: string
    text: string
    at: Vec3
    kind: ScreenLabel['kind']
  }> = []

  // -------------------------------------------------------------------------
  // Command handles
  // -------------------------------------------------------------------------

  setHandles(handles: WorldHandle[], hot: string | null) {
    this.handles = handles
    for (const child of [...this.handleGroup.children]) {
      this.handleGroup.remove(child)
      child.traverse((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose?.()
        ;(mesh.material as THREE.Material | undefined)?.dispose?.()
      })
    }
    for (const handle of handles) {
      const colour = handle.id === hot ? HANDLE_HOT : HANDLE
      const tip = this.handleTip(handle)
      const material = () =>
        new THREE.MeshBasicMaterial({ color: colour, depthTest: false, transparent: true })
      const points = this.handlePath(handle)
      for (let i = 0; i + 1 < points.length; i++) {
        const shaft = new THREE.Mesh(
          new THREE.CylinderGeometry(1.5, 1.5, 1, 8).translate(0, 0.5, 0),
          material(),
        )
        const from = new THREE.Vector3(...points[i])
        const along = new THREE.Vector3(...points[i + 1]).sub(from)
        shaft.position.copy(from)
        if (along.lengthSq() > 1e-12) {
          shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.clone().normalize())
        }
        shaft.renderOrder = 20
        shaft.userData = { shaftAt: points[i], shaftLength: along.length() }
        this.handleGroup.add(shaft)
      }
      const knob = new THREE.Mesh(
        handle.kind === 'arrow'
          ? new THREE.ConeGeometry(7, 22, 24).translate(0, -11, 0)
          : new THREE.SphereGeometry(7, 16, 12),
        material(),
      )
      knob.position.set(...tip)
      if (handle.kind === 'arrow') {
        const pointing = new THREE.Vector3(...handle.direction).multiplyScalar(
          handle.length < 0 ? -1 : 1,
        )
        knob.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pointing.normalize())
      }
      knob.renderOrder = 21
      knob.userData = { handleId: handle.id, scaleAt: tip }
      this.handleGroup.add(knob)
    }
    this.scaleHandles()
  }

  private handleTip(handle: WorldHandle): Vec3 {
    if (handle.kind === 'arrow') {
      return v3.add(handle.origin, v3.scale(handle.direction, handle.length))
    }
    return this.arcPoint(handle, handle.length)
  }

  private arcPoint(handle: WorldHandle, degrees: number): Vec3 {
    const axis = new THREE.Vector3(...handle.direction).normalize()
    const start = new THREE.Vector3(...(handle.start ?? [1, 0, 0]))
      .multiplyScalar(handle.radius ?? 10)
      .applyAxisAngle(axis, (degrees * Math.PI) / 180)
    return [handle.origin[0] + start.x, handle.origin[1] + start.y, handle.origin[2] + start.z]
  }

  private handlePath(handle: WorldHandle): Vec3[] {
    if (handle.kind === 'arrow') return [handle.origin, this.handleTip(handle)]
    const steps = Math.max(8, Math.ceil(Math.abs(handle.length) / 5))
    return Array.from({ length: steps + 1 }, (_, i) =>
      this.arcPoint(handle, (handle.length * i) / steps),
    )
  }

  private scaleHandles() {
    for (const child of this.handleGroup.children) {
      const at = child.userData.scaleAt as Vec3 | undefined
      if (at) child.scale.setScalar(this.pixelSize(at))
      const shaftAt = child.userData.shaftAt as Vec3 | undefined
      if (shaftAt) {
        const thickness = this.pixelSize(shaftAt)
        child.scale.set(thickness, child.userData.shaftLength as number, thickness)
      }
    }
  }

  private screenOf(point: Vec3): [number, number] | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const projected = new THREE.Vector3(...point).project(this.camera)
    if (projected.z > 1) return null
    return [((projected.x + 1) / 2) * rect.width, ((1 - projected.y) / 2) * rect.height]
  }

  pickHandle(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    let best: { id: string; distance: number } | null = null
    for (const handle of this.handles) {
      const screen = this.screenOf(this.handleTip(handle))
      if (!screen) continue
      const distance = Math.hypot(screen[0] - x, screen[1] - y)
      if (distance < HANDLE_GRAB_PX && (!best || distance < best.distance)) {
        best = { id: handle.id, distance }
      }
    }
    return best?.id ?? null
  }

  arrowParameter(clientX: number, clientY: number, origin: Vec3, direction: Vec3): number | null {
    this.raycaster.setFromCamera(this.pointerToNdc(clientX, clientY), this.camera)
    const ray = this.raycaster.ray
    const d = new THREE.Vector3(...direction).normalize()
    const w = new THREE.Vector3(...origin).sub(ray.origin)
    const b = d.dot(ray.direction)
    const denominator = 1 - b * b
    if (denominator < 1e-9) return null
    return (b * w.dot(ray.direction) - w.dot(d)) / denominator
  }

  arcAngle(clientX: number, clientY: number, handle: WorldHandle): number | null {
    this.raycaster.setFromCamera(this.pointerToNdc(clientX, clientY), this.camera)
    const axis = new THREE.Vector3(...handle.direction).normalize()
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      axis,
      new THREE.Vector3(...handle.origin),
    )
    const hit = new THREE.Vector3()
    if (!this.raycaster.ray.intersectPlane(plane, hit)) return null
    const radial = hit.sub(new THREE.Vector3(...handle.origin))
    const start = new THREE.Vector3(...(handle.start ?? [1, 0, 0]))
    const angle = Math.atan2(
      new THREE.Vector3().crossVectors(start, radial).dot(axis),
      start.dot(radial),
    )
    const degrees = (angle * 180) / Math.PI
    return degrees <= 0 ? degrees + 360 : degrees
  }

  private projectHandles() {
    if (!this.onHandleScreens) return
    const next = this.handles.flatMap((handle) => {
      const screen = this.screenOf(this.handleTip(handle))
      return screen ? [{ id: handle.id, x: screen[0], y: screen[1] }] : []
    })
    const moved =
      next.length !== this.handleScreens.length ||
      next.some(
        (screen, i) =>
          screen.id !== this.handleScreens[i].id ||
          Math.abs(screen.x - this.handleScreens[i].x) > 0.5 ||
          Math.abs(screen.y - this.handleScreens[i].y) > 0.5,
      )
    if (!moved) return
    this.handleScreens = next
    this.onHandleScreens(next)
  }

  // -------------------------------------------------------------------------
  // Move / turn gizmo
  // -------------------------------------------------------------------------

  private transform: TransformControls | null = null
  private gizmoProxy = new THREE.Object3D()
  onGizmoChange: ((pose: GizmoPose) => void) | null = null
  onGizmoRelease: (() => void) | null = null

  private ensureTransform(): TransformControls {
    if (this.transform) return this.transform
    const tc = new TransformControls(this.camera, this.renderer.domElement)
    tc.setSize(0.9)
    const preferences = usePreferences.getState().values
    tc.setTranslationSnap(preferences.moveSnap || null)
    tc.setRotationSnap(
      preferences.angleSnap ? THREE.MathUtils.degToRad(preferences.angleSnap) : null,
    )

    tc.addEventListener('dragging-changed', (event) => {
      const dragging = (event as unknown as { value: boolean }).value
      this.controls.enabled = !dragging
      if (!dragging) this.onGizmoRelease?.()
    })
    tc.addEventListener('objectChange', () => {
      const proxy = this.gizmoProxy
      proxy.updateMatrix()
      const deg = (a: number) => THREE.MathUtils.radToDeg(a)
      this.onGizmoChange?.({
        position: [proxy.position.x, proxy.position.y, proxy.position.z],
        rotationXyz: [deg(proxy.rotation.x), deg(proxy.rotation.y), deg(proxy.rotation.z)],
        matrix: Array.from(proxy.matrix.elements) as Matrix4,
      })
    })

    const helper =
      typeof (tc as unknown as { getHelper?: () => THREE.Object3D }).getHelper === 'function'
        ? (tc as unknown as { getHelper: () => THREE.Object3D }).getHelper()
        : (tc as unknown as THREE.Object3D)
    this.overlayGroup.add(helper)
    this.transform = tc
    return tc
  }

  setGizmo(
    target: {
      position: Vec3
      rotationXyz?: Vec3
      matrix?: Matrix4
    } | null,
    mode: 'translate' | 'rotate',
  ) {
    if (!target) {
      this.transform?.detach()
      return
    }
    const tc = this.ensureTransform()
    if (!this.gizmoProxy.parent) this.scene.add(this.gizmoProxy)
    const rad = THREE.MathUtils.degToRad
    const xyz = target.rotationXyz
    if (!tc.dragging) {
      if (target.matrix) {
        const scale = new THREE.Vector3()
        new THREE.Matrix4()
          .fromArray(target.matrix)
          .decompose(this.gizmoProxy.position, this.gizmoProxy.quaternion, scale)
      } else {
        this.gizmoProxy.position.set(...target.position)
        this.gizmoProxy.rotation.set(rad(xyz?.[0] ?? 0), rad(xyz?.[1] ?? 0), rad(xyz?.[2] ?? 0))
      }
      this.gizmoProxy.updateMatrix()
    }
    tc.attach(this.gizmoProxy)
    tc.setMode(mode)
    const freeTurn = mode === 'translate' || !target.matrix
    tc.showX = freeTurn
    tc.showY = freeTurn
    tc.showZ = true
  }

  // ---------------------------------------------------------------------------
  // Fastener ghosts
  // ---------------------------------------------------------------------------

  private ghostGroup = new THREE.Group()
  private ghostMaterials: Record<'brass' | 'steel', THREE.Material> | null = null

  private ghostMaterial(metal: 'brass' | 'steel'): THREE.Material {
    if (!this.ghostMaterials) {
      const make = (colour: number) =>
        new THREE.MeshStandardMaterial({
          color: colour,
          metalness: 0.85,
          roughness: 0.35,
          transparent: true,
          opacity: 0.55,
          // Drawn over the solid rather than fighting it: the shaft is inside
          // the part, and z-fighting against the hole wall would make it
          // flicker as the camera moves.
          depthWrite: false,
        })
      this.ghostMaterials = { brass: make(0xc08a3e), steel: make(0xa8b0b8) }
    }
    return this.ghostMaterials[metal]
  }

  /** Draw ghosts of the screws and inserts, or pass an empty list to clear. */
  setFastenerGhosts(ghosts: FastenerGhost[]) {
    if (!this.ghostGroup.parent) this.overlayGroup.add(this.ghostGroup)
    for (const child of [...this.ghostGroup.children]) {
      this.ghostGroup.remove(child)
      ;(child as THREE.Mesh).geometry?.dispose()
    }

    const up = new THREE.Vector3()
    for (const g of ghosts) {
      up.set(g.up[0], g.up[1], g.up[2]).normalize()
      // Cylinders are built along +Y, so everything is made upright and then
      // turned once onto the fastener's own axis.
      const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up)
      const material = this.ghostMaterial(g.metal)

      const place = (mesh: THREE.Mesh, along: number) => {
        mesh.quaternion.copy(turn)
        mesh.position.set(g.at[0] + up.x * along, g.at[1] + up.y * along, g.at[2] + up.z * along)
        mesh.renderOrder = 3
        this.ghostGroup.add(mesh)
      }

      // The shaft hangs below the surface, so its centre is half its length in.
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(g.shaftDiameter / 2, g.shaftDiameter / 2, g.shaftLength, 20),
        material,
      )
      place(shaft, -g.shaftLength / 2 - g.headSink)

      if (g.headDiameter > 0) {
        if (g.countersunk) {
          // Wide at the surface, tapering down to the shaft.
          const cone = new THREE.Mesh(
            new THREE.CylinderGeometry(
              g.headDiameter / 2,
              g.shaftDiameter / 2,
              (g.headDiameter - g.shaftDiameter) / 2,
              20,
            ),
            material,
          )
          place(cone, -(g.headDiameter - g.shaftDiameter) / 4)
        } else {
          const head = new THREE.Mesh(
            new THREE.CylinderGeometry(g.headDiameter / 2, g.headDiameter / 2, g.headHeight, 20),
            material,
          )
          place(head, g.headHeight / 2 - g.headSink)
        }
      }
    }
  }

  isGizmoDragging(): boolean {
    return !!this.transform?.dragging
  }

  // -------------------------------------------------------------------------
  // Picking
  // -------------------------------------------------------------------------

  private pointerToNdc(clientX: number, clientY: number): THREE.Vector2 {
    this.camera.updateMatrixWorld()
    this.solidGroup.updateMatrixWorld(true)
    const rect = this.renderer.domElement.getBoundingClientRect()
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
  }

  private pickables(): THREE.Mesh[] {
    return [...this.objects.values()]
      .filter((entry) => !entry.instance.previewTool)
      .map((entry) => entry.mesh)
  }

  pick(clientX: number, clientY: number): PickResult | null {
    this.raycaster.setFromCamera(this.pointerToNdc(clientX, clientY), this.camera)
    const hit = this.raycaster.intersectObjects(this.pickables(), false)[0]
    if (!hit) return null
    const entry = this.objects.get(hit.object.userData.instanceId)
    if (!entry) return null
    const localNormal = hit.face ? hit.face.normal.clone().normalize() : new THREE.Vector3(0, 0, 1)
    const normal = localNormal
      .clone()
      .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
      .normalize()
    const local = hit.object.worldToLocal(hit.point.clone())
    const triangle = (hit.faceIndex ?? 0) * 3
    const group = this.geometries
      .get(entry.instance.meshKey)
      ?.data.faceGroups.find((g) => triangle >= g.start && triangle < g.start + g.count)
    return {
      instanceId: entry.instance.id,
      kind: entry.instance.kind,
      bodyId: entry.instance.bodyId,
      path: entry.instance.path,
      point: [hit.point.x, hit.point.y, hit.point.z],
      normal: [normal.x, normal.y, normal.z],
      localPoint: [local.x, local.y, local.z],
      localNormal: [localNormal.x, localNormal.y, localNormal.z],
      faceId: hit.faceIndex ?? -1,
      faceName: group?.name ?? '',
    }
  }

  pickOnPlane(clientX: number, clientY: number, frame: Frame): Vec2 | null {
    this.raycaster.setFromCamera(this.pointerToNdc(clientX, clientY), this.camera)
    const plane = new THREE.Plane()
    plane.setFromNormalAndCoplanarPoint(
      new THREE.Vector3(...frame.normal),
      new THREE.Vector3(...frame.origin),
    )
    const point = new THREE.Vector3()
    if (!this.raycaster.ray.intersectPlane(plane, point)) return null
    const d = point.clone().sub(new THREE.Vector3(...frame.origin))
    return [d.dot(new THREE.Vector3(...frame.xDir)), d.dot(new THREE.Vector3(...frame.yDir))]
  }

  /**
   * Pick the face, edge or corner under the cursor.
   *
   * Smallest target wins: a corner beats an edge, an edge beats the face it
   * sits on. Anything else and edges become unclickable, because the face
   * behind them is always the bigger target.
   */
  pickSub(clientX: number, clientY: number): SubPick | null {
    const ndc = this.pointerToNdc(clientX, clientY)
    this.raycaster.setFromCamera(ndc, this.camera)

    const rect = this.renderer.domElement.getBoundingClientRect()
    const cx = clientX - rect.left
    const cy = clientY - rect.top
    const toScreen = (v: THREE.Vector3) => {
      const p = v.clone().project(this.camera)
      return [((p.x + 1) / 2) * rect.width, ((1 - p.y) / 2) * rect.height]
    }

    const bodies = [...this.objects.values()].filter(
      (entry) => entry.instance.kind === 'body' && !entry.instance.previewTool,
    )

    const VERTEX_PX = 9
    let bestVertex: { entry: InstanceObject; pos: Vec3; d: number } | null = null
    const world = new THREE.Vector3()
    for (const entry of bodies) {
      const groups = this.geometries.get(entry.instance.meshKey)?.data
      if (!groups) continue
      const seen = new Set<string>()
      for (let i = 0; i < groups.lines.length; i += 3) {
        const x = groups.lines[i]
        const y = groups.lines[i + 1]
        const z = groups.lines[i + 2]
        const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`
        if (seen.has(key)) continue
        seen.add(key)
        world.set(x, y, z).applyMatrix4(entry.mesh.matrixWorld)
        const [sx, sy] = toScreen(world)
        const d = Math.hypot(sx - cx, sy - cy)
        if (d < VERTEX_PX && (!bestVertex || d < bestVertex.d)) {
          bestVertex = { entry, pos: [x, y, z], d }
        }
      }
    }
    if (bestVertex) {
      const p = bestVertex.pos
      return {
        instanceId: bestVertex.entry.instance.id,
        bodyId: bestVertex.entry.instance.bodyId,
        kind: 'vertex',
        id: `v:${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}`,
        name: '',
        point: p,
      }
    }

    const hit = this.raycaster.intersectObjects(
      bodies.map((entry) => entry.mesh),
      false,
    )[0]
    if (!hit) return null

    const entry = this.objects.get(hit.object.userData.instanceId)
    const data = entry ? this.geometries.get(entry.instance.meshKey)?.data : undefined
    if (!entry || !data) return null
    const worldPoint: Vec3 = [hit.point.x, hit.point.y, hit.point.z]
    const localHit = hit.object.worldToLocal(hit.point.clone())

    const previous = this.raycaster.params.Line?.threshold
    this.raycaster.params.Line = { threshold: this.pixelSize(worldPoint) * 6 }
    const lineHit = this.raycaster.intersectObject(entry.outline, false)[0]
    this.raycaster.params.Line = { threshold: previous ?? 1 }
    if (lineHit && lineHit.distance <= hit.distance + this.pixelSize(worldPoint) * 6) {
      const vertexIndex = lineHit.index ?? 0
      const group = data.edgeGroups.find(
        (g) => vertexIndex >= g.start && vertexIndex < g.start + g.count,
      )
      if (group) {
        return {
          instanceId: entry.instance.id,
          bodyId: entry.instance.bodyId,
          kind: 'edge',
          id: elementKey('e', group.name, group.edgeId),
          name: group.name,
          point: this.edgeMidpoint(data, group),
          length: this.edgeLength(data, group),
        }
      }
    }

    const triangle = (hit.faceIndex ?? 0) * 3
    const group = data.faceGroups.find((g) => triangle >= g.start && triangle < g.start + g.count)
    const normal = hit.face ? hit.face.normal.clone().normalize() : new THREE.Vector3(0, 0, 1)
    return {
      instanceId: entry.instance.id,
      bodyId: entry.instance.bodyId,
      kind: 'face',
      id: group ? elementKey('f', group.name, group.faceId) : 'f#unknown',
      name: group?.name ?? '',
      point: [localHit.x, localHit.y, localHit.z],
      normal: [normal.x, normal.y, normal.z],
    }
  }

  private edgeMidpoint(data: ShapeGroups, group: { start: number; count: number }): Vec3 {
    let x = 0
    let y = 0
    let z = 0
    for (let i = group.start; i < group.start + group.count; i++) {
      x += data.lines[i * 3]
      y += data.lines[i * 3 + 1]
      z += data.lines[i * 3 + 2]
    }
    return [x / group.count, y / group.count, z / group.count]
  }

  private edgeLength(data: ShapeGroups, group: { start: number; count: number }): number {
    let total = 0
    for (let i = group.start; i + 1 < group.start + group.count; i += 2) {
      total += Math.hypot(
        data.lines[(i + 1) * 3] - data.lines[i * 3],
        data.lines[(i + 1) * 3 + 1] - data.lines[i * 3 + 1],
        data.lines[(i + 1) * 3 + 2] - data.lines[i * 3 + 2],
      )
    }
    return total
  }

  private selectedPicks: SubPick[] = []
  private hoverPick: SubPick | null = null

  /** Draw whatever is selected on top of the solid. */
  setSubHighlight(picks: SubPick[]) {
    this.selectedPicks = picks
    this.rebuildHighlight()
  }

  /**
   * Show what a click would select, before it is clicked. This is the whole
   * difference between selection that feels precise and selection that feels
   * like guessing, and it costs one extra pick per pointer move.
   */
  setHoverPick(pick: SubPick | null) {
    const same =
      (pick?.id ?? null) === (this.hoverPick?.id ?? null) &&
      (pick?.instanceId ?? null) === (this.hoverPick?.instanceId ?? null)
    if (same) return
    this.hoverPick = pick
    this.rebuildHighlight()
  }

  private rebuildHighlight() {
    const picks = this.selectedPicks
    for (const child of [...this.highlightGroup.children]) {
      this.highlightGroup.remove(child)
      child.traverse((obj) => (obj as THREE.Mesh).geometry?.dispose?.())
    }

    const alreadySelected = (p: SubPick) =>
      picks.some((s) => s.instanceId === p.instanceId && s.id === p.id)
    const all =
      this.hoverPick && !alreadySelected(this.hoverPick) ? [...picks, this.hoverPick] : picks

    const buckets = new Map<
      string,
      {
        faces: number[]
        edges: number[]
        corners: number[]
        hoverFaces: number[]
        hoverEdges: number[]
        hoverCorners: number[]
      }
    >()

    for (const pick of all) {
      const isHover = pick === this.hoverPick && !alreadySelected(pick)
      const entry = this.objects.get(pick.instanceId)
      const data = entry ? this.geometries.get(entry.instance.meshKey)?.data : undefined
      if (!data) continue
      let bucket = buckets.get(pick.instanceId)
      if (!bucket) {
        bucket = {
          faces: [],
          edges: [],
          corners: [],
          hoverFaces: [],
          hoverEdges: [],
          hoverCorners: [],
        }
        buckets.set(pick.instanceId, bucket)
      }

      if (pick.kind === 'vertex') {
        ;(isHover ? bucket.hoverCorners : bucket.corners).push(...pick.point)
      } else if (pick.kind === 'edge') {
        const group = data.edgeGroups.find((g) => elementKey('e', g.name, g.edgeId) === pick.id)
        if (!group) continue
        const into = isHover ? bucket.hoverEdges : bucket.edges
        for (let i = group.start; i < group.start + group.count; i++) {
          into.push(data.lines[i * 3], data.lines[i * 3 + 1], data.lines[i * 3 + 2])
        }
      } else {
        const group = data.faceGroups.find((g) => elementKey('f', g.name, g.faceId) === pick.id)
        if (!group) continue
        const into = isHover ? bucket.hoverFaces : bucket.faces
        for (let i = group.start; i < group.start + group.count; i++) {
          const v = data.triangles[i] * 3
          into.push(data.vertices[v], data.vertices[v + 1], data.vertices[v + 2])
        }
      }
    }

    for (const [instanceId, bucket] of buckets) {
      const entry = this.objects.get(instanceId)
      if (!entry) continue
      const holder = new THREE.Group()
      holder.matrixAutoUpdate = false
      holder.matrix.copy(entry.mesh.matrix)
      holder.matrixWorldNeedsUpdate = true

      const drawFaces = (coords: number[], opacity: number) => {
        if (!coords.length) return
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3))
        geometry.computeVertexNormals()
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshBasicMaterial({
            color: ACCENT,
            transparent: true,
            opacity,
            side: THREE.DoubleSide,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
          }),
        )
        mesh.renderOrder = 5
        holder.add(mesh)
      }

      const drawEdges = (coords: number[], colour: number) => {
        if (!coords.length) return
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3))
        const lines = new THREE.LineSegments(
          geometry,
          new THREE.LineBasicMaterial({ color: colour, depthTest: false }),
        )
        lines.renderOrder = 12
        holder.add(lines)
      }

      const drawCorners = (coords: number[], colour: number, size: number) => {
        if (!coords.length) return
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3))
        const points = new THREE.Points(
          geometry,
          new THREE.PointsMaterial({
            color: colour,
            size,
            sizeAttenuation: false,
            depthTest: false,
          }),
        )
        points.renderOrder = 13
        holder.add(points)
      }

      drawFaces(bucket.hoverFaces, 0.18)
      drawEdges(bucket.hoverEdges, HOVER)
      drawCorners(bucket.hoverCorners, HOVER, 8)
      drawFaces(bucket.faces, 0.45)
      drawEdges(bucket.edges, ACCENT)
      drawCorners(bucket.corners, ACCENT, 9)
      this.highlightGroup.add(holder)
    }
  }

  /** Millimetres per screen pixel at a point, for size-independent snapping. */
  pixelSize(at: Vec3): number {
    const distance = this.camera.position.distanceTo(new THREE.Vector3(...at))
    const height = 2 * Math.tan((this.camera.fov * Math.PI) / 360) * distance
    return height / this.renderer.domElement.clientHeight
  }

  // -------------------------------------------------------------------------
  // Camera
  // -------------------------------------------------------------------------

  frameAll(bounds?: [number, number, number, number, number, number]) {
    const box = bounds
      ? new THREE.Box3(
          new THREE.Vector3(bounds[0], bounds[1], bounds[2]),
          new THREE.Vector3(bounds[3], bounds[4], bounds[5]),
        )
      : new THREE.Box3().setFromObject(this.solidGroup)
    // Nothing to frame: leave the view exactly as it is. Resetting to a default
    // here meant that pressing "Make solid" - which asks for a fit before the
    // kernel has finished rebuilding - threw the camera back to its start
    // position instead of framing the part that was about to appear.
    if (box.isEmpty()) return

    const centre = box.getCenter(new THREE.Vector3())
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 10)
    const direction = this.camera.position.clone().sub(this.controls.target).normalize()
    this.controls.target.copy(centre)
    this.camera.position.copy(centre).addScaledVector(direction, radius * 3.1)
    this.camera.near = Math.max(radius / 500, 0.05)
    this.camera.far = radius * 200
    this.camera.updateProjectionMatrix()
    // Orient now rather than waiting for the controls to catch up on the next
    // frame, so a click straight after a fit hits what the user is looking at.
    this.camera.lookAt(centre)
  }

  /** Look straight at a sketch plane, keeping the current distance. */
  lookAtFrame(frame: Frame) {
    const distance = this.camera.position.distanceTo(this.controls.target)
    const centre = new THREE.Vector3(...frame.origin)
    this.controls.target.copy(centre)
    this.camera.position.copy(centre).addScaledVector(new THREE.Vector3(...frame.normal), distance)
    // Sketch x points up the screen rather than across it, which turns the
    // drawing a quarter turn anticlockwise to match the 3D view's home angle.
    this.camera.up.set(...frame.xDir)
    this.camera.lookAt(centre)
  }

  setStandardView(view: 'top' | 'front' | 'right' | 'iso') {
    const target = this.controls.target.clone()
    const distance = this.camera.position.distanceTo(target) || 400
    const dirs: Record<string, [Vec3, Vec3]> = {
      top: [
        [0, 0, 1],
        [0, 1, 0],
      ],
      front: [
        [0, -1, 0],
        [0, 0, 1],
      ],
      right: [
        [1, 0, 0],
        [0, 0, 1],
      ],
      // Matches HOME_CAMERA, so pressing 3D returns to the view you started at.
      iso: [
        [-0.72, -0.6, 0.55],
        [0, 0, 1],
      ],
    }
    const [dir, up] = dirs[view]
    this.camera.up.set(...up)
    this.camera.position
      .copy(target)
      .addScaledVector(new THREE.Vector3(...dir).normalize(), distance)
    this.camera.lookAt(target)
  }

  setControlsEnabled(enabled: boolean) {
    this.controls.enableRotate = enabled
  }

  setFingerNavigation(orbit: boolean) {
    this.controls.touches.ONE = orbit ? THREE.TOUCH.ROTATE : THREE.TOUCH.PAN
    this.controls.enableRotate = orbit
  }

  // -------------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------------

  resize() {
    const { clientWidth, clientHeight } = this.container
    if (clientWidth === 0 || clientHeight === 0) return
    // Let three.js set the canvas CSS size as well as its backing-store size.
    // Skipping that (setSize's third argument) leaves the canvas laid out at
    // its device-pixel size - double on a retina display - so every ray-cast is
    // computed against a viewport twice the real one and picking lands nowhere
    // near the cursor.
    this.renderer.setSize(clientWidth, clientHeight)
    this.camera.aspect = clientWidth / clientHeight
    this.camera.updateProjectionMatrix()
  }

  private animate = () => {
    if (this.disposed) return
    requestAnimationFrame(this.animate)
    this.controls.update()
    this.scaleHandles()
    this.renderer.render(this.scene, this.camera)
    this.projectHandles()

    if (this.onLabels) {
      const rect = this.renderer.domElement.getBoundingClientRect()
      const next: ScreenLabel[] = []
      for (const label of this.worldLabels) {
        const v = new THREE.Vector3(...label.at).project(this.camera)
        if (v.z > 1) continue
        next.push({
          id: label.id,
          text: label.text,
          kind: label.kind,
          x: ((v.x + 1) / 2) * rect.width,
          y: ((1 - v.y) / 2) * rect.height,
        })
      }
      // Only push when something actually moved, to avoid a React render storm.
      if (
        next.length !== this.labels.length ||
        next.some(
          (l, i) =>
            Math.abs(l.x - this.labels[i].x) > 0.5 ||
            Math.abs(l.y - this.labels[i].y) > 0.5 ||
            l.text !== this.labels[i].text,
        )
      ) {
        this.labels = next
        this.onLabels(next)
      }
    }
  }

  dispose() {
    this.disposed = true
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
