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
import type { ShapeResult } from '../kernel/types'
import type { Frame, Vec2, Vec3 } from '../core/math'
import { frameToWorld } from '../core/math'
import type { Sketch2D } from '../sketch/types'
import { arcMidpoint } from '../kernel/profile'

export interface ScreenLabel {
  id: string
  text: string
  x: number
  y: number
  kind: 'dimension' | 'hint' | 'measure' | 'constraint'
}

export interface PickResult {
  id: string
  kind: 'body' | 'placement'
  point: Vec3
  normal: Vec3
  faceId: number
}

/** A face, edge or corner of a built solid. */
export interface SubPick {
  bodyId: string
  kind: 'face' | 'edge' | 'vertex'
  /** Stable within one rebuild: the kernel's own id, or a welded position. */
  id: string
  point: Vec3
  normal?: Vec3
  /** Edge length, so a fillet can record a fingerprint of what was picked. */
  length?: number
}

/** Per-shape tessellation kept so a pick can be traced back to a B-rep face. */
interface ShapeGroups {
  vertices: Float32Array
  triangles: Uint32Array
  faceGroups: ShapeResult['mesh']['faceGroups']
  lines: Float32Array
  edgeGroups: ShapeResult['edges']['edgeGroups']
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
const ACCENT_DIM = 0xc4761c
/** Pre-selection: what a click would take. */
const HOVER = 0xffd9a0
const SKETCH_LINE = 0xf2ede4
const CONSTRUCTION = 0x6f7681
/** Geometry that is not yet pinned down. */
const UNDERDEFINED = 0x5aa9e6

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

  private meshes = new Map<string, THREE.Mesh>()
  private outlines = new Map<string, THREE.LineSegments>()
  private groups = new Map<string, ShapeGroups>()
  private highlightGroup = new THREE.Group()
  private clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)

  private disposed = false
  labels: ScreenLabel[] = []
  onLabels: ((labels: ScreenLabel[]) => void) | null = null

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.localClippingEnabled = true
    this.renderer.setClearColor(0x15171a, 1)
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
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    }

    this.scene.add(
      this.solidGroup,
      this.sketchGroup,
      this.overlayGroup,
      this.gridGroup,
      this.highlightGroup,
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
    const grid = new THREE.GridHelper(1000, 100, 0x3a4048, 0x24282d)
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

  // -------------------------------------------------------------------------
  // Solids
  // -------------------------------------------------------------------------

  setShapes(shapes: ShapeResult[], showPlacements: boolean) {
    const seen = new Set<string>()

    for (const shape of shapes) {
      if (shape.kind === 'placement' && !showPlacements) continue
      seen.add(shape.id)

      let mesh = this.meshes.get(shape.id)
      if (!mesh) {
        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(shape.colour),
          roughness: 0.62,
          metalness: 0.08,
          clippingPlanes: [],
          side: THREE.DoubleSide,
        })
        mesh = new THREE.Mesh(new THREE.BufferGeometry(), material)
        mesh.userData = { id: shape.id, kind: shape.kind }
        this.meshes.set(shape.id, mesh)
        this.solidGroup.add(mesh)

        const outline = new THREE.LineSegments(
          new THREE.BufferGeometry(),
          new THREE.LineBasicMaterial({ color: 0x1a1d21, transparent: true, opacity: 0.85 }),
        )
        this.outlines.set(shape.id, outline)
        this.solidGroup.add(outline)
      }

      const geometry = mesh.geometry
      geometry.setAttribute('position', new THREE.BufferAttribute(shape.mesh.vertices, 3))
      geometry.setAttribute('normal', new THREE.BufferAttribute(shape.mesh.normals, 3))
      geometry.setIndex(new THREE.BufferAttribute(shape.mesh.triangles, 1))
      geometry.computeBoundingSphere()
      ;(mesh.material as THREE.MeshStandardMaterial).color.set(shape.colour)

      const outline = this.outlines.get(shape.id)!
      outline.geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(shape.edges.lines, 3),
      )
      outline.geometry.computeBoundingSphere()

      this.groups.set(shape.id, {
        vertices: shape.mesh.vertices,
        triangles: shape.mesh.triangles,
        faceGroups: shape.mesh.faceGroups,
        lines: shape.edges.lines,
        edgeGroups: shape.edges.edgeGroups,
      })
    }

    for (const [id, mesh] of [...this.meshes]) {
      if (seen.has(id)) continue
      this.solidGroup.remove(mesh)
      mesh.geometry.dispose()
      this.meshes.delete(id)
      const outline = this.outlines.get(id)
      if (outline) {
        this.solidGroup.remove(outline)
        outline.geometry.dispose()
        this.outlines.delete(id)
      }
    }
  }

  setHighlight(hovered: string | null, selected: string | null) {
    for (const [id, mesh] of this.meshes) {
      const material = mesh.material as THREE.MeshStandardMaterial
      if (id === selected) {
        material.emissive.setHex(ACCENT)
        material.emissiveIntensity = 0.32
      } else if (id === hovered) {
        material.emissive.setHex(ACCENT_DIM)
        material.emissiveIntensity = 0.16
      } else {
        material.emissive.setHex(0x000000)
        material.emissiveIntensity = 0
      }
    }
  }

  setOpacity(dimmed: boolean) {
    for (const mesh of this.meshes.values()) {
      const material = mesh.material as THREE.MeshStandardMaterial
      material.transparent = dimmed
      material.opacity = dimmed ? 0.28 : 1
      material.depthWrite = !dimmed
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
    const planes = enabled ? [this.clipPlane] : []
    for (const mesh of this.meshes.values()) {
      ;(mesh.material as THREE.Material).clippingPlanes = planes
    }
    for (const outline of this.outlines.values()) {
      ;(outline.material as THREE.Material).clippingPlanes = planes
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
      if (entity.kind === 'line') {
        target.push(to3(pts.get(entity.p1)!), to3(pts.get(entity.p2)!))
      } else if (entity.kind === 'circle') {
        const c = pts.get(entity.c)!
        let prev: Vec2 = [c[0] + entity.r, c[1]]
        for (let i = 1; i <= 64; i++) {
          const a = (i / 64) * Math.PI * 2
          const next: Vec2 = [c[0] + entity.r * Math.cos(a), c[1] + entity.r * Math.sin(a)]
          target.push(to3(prev), to3(next))
          prev = next
        }
      } else {
        const c = pts.get(entity.c)!
        const p1 = pts.get(entity.p1)!
        const p2 = pts.get(entity.p2)!
        const mid = arcMidpoint(entity, pts)
        const r = Math.hypot(p1[0] - c[0], p1[1] - c[1])
        const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0])
        const am = Math.atan2(mid[1] - c[1], mid[0] - c[0])
        const a2 = Math.atan2(p2[1] - c[1], p2[0] - c[0])
        const TAU = Math.PI * 2
        const norm = (x: number) => ((x % TAU) + TAU) % TAU
        const sweep = entity.ccw ? norm(a2 - a1) : -norm(a1 - a2)
        void am
        let prev = p1
        for (let i = 1; i <= 48; i++) {
          const a = a1 + (sweep * i) / 48
          const next: Vec2 = [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]
          target.push(to3(prev), to3(next))
          prev = next
        }
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
  // Move / turn gizmo
  // -------------------------------------------------------------------------

  private transform: TransformControls | null = null
  /**
   * The gizmo drags this stand-in rather than the mesh itself. Placed parts are
   * rebuilt from scratch by the kernel on every edit, so the mesh the user sees
   * is replaced mid-drag; a proxy survives that.
   */
  private gizmoProxy = new THREE.Object3D()
  onGizmoChange: ((position: Vec3, rotationDeg: number) => void) | null = null
  onGizmoRelease: (() => void) | null = null

  private ensureTransform(): TransformControls {
    if (this.transform) return this.transform
    const tc = new TransformControls(this.camera, this.renderer.domElement)
    tc.setSize(0.9)
    // Snap to whole millimetres and 15 degrees. Hold shift for fine control.
    tc.setTranslationSnap(1)
    tc.setRotationSnap(THREE.MathUtils.degToRad(15))

    tc.addEventListener('dragging-changed', (event) => {
      const dragging = (event as unknown as { value: boolean }).value
      // Orbiting while dragging a gizmo handle is nauseating; stop it dead.
      this.controls.enabled = !dragging
      if (!dragging) this.onGizmoRelease?.()
    })
    tc.addEventListener('objectChange', () => {
      const p = this.gizmoProxy.position
      const deg = THREE.MathUtils.radToDeg(this.gizmoProxy.rotation.z)
      this.onGizmoChange?.([p.x, p.y, p.z], deg)
    })

    // three moved the visible gizmo behind getHelper() in recent versions.
    const helper =
      typeof (tc as unknown as { getHelper?: () => THREE.Object3D }).getHelper === 'function'
        ? (tc as unknown as { getHelper: () => THREE.Object3D }).getHelper()
        : (tc as unknown as THREE.Object3D)
    this.overlayGroup.add(helper)
    this.transform = tc
    return tc
  }

  /** Show the gizmo on something, or pass null to hide it. */
  setGizmo(
    target: { position: Vec3; rotation: number } | null,
    mode: 'translate' | 'rotate',
  ) {
    if (!target) {
      this.transform?.detach()
      return
    }
    const tc = this.ensureTransform()
    if (!this.gizmoProxy.parent) this.scene.add(this.gizmoProxy)
    // Never move the proxy out from under a drag in progress.
    if (!tc.dragging) {
      this.gizmoProxy.position.set(...target.position)
      this.gizmoProxy.rotation.set(0, 0, THREE.MathUtils.degToRad(target.rotation))
    }
    tc.attach(this.gizmoProxy)
    tc.setMode(mode)
    // Placed parts only turn about the vertical axis, so the turn gizmo shows
    // one ring rather than three the user can get wrong.
    tc.showX = mode === 'translate'
    tc.showY = mode === 'translate'
    tc.showZ = true
  }

  isGizmoDragging(): boolean {
    return !!this.transform?.dragging
  }

  // -------------------------------------------------------------------------
  // Picking
  // -------------------------------------------------------------------------

  private pointerToNdc(clientX: number, clientY: number): THREE.Vector2 {
    // The raycaster reads camera.matrixWorld, which is normally refreshed by
    // the renderer once per frame. Anything that moves the camera and then
    // picks before the next frame - entering sketch mode and clicking straight
    // away, or a tab that is not compositing - would otherwise cast the ray
    // from where the camera used to be.
    this.camera.updateMatrixWorld()
    const rect = this.renderer.domElement.getBoundingClientRect()
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
  }

  pick(clientX: number, clientY: number): PickResult | null {
    this.raycaster.setFromCamera(this.pointerToNdc(clientX, clientY), this.camera)
    const hits = this.raycaster.intersectObjects([...this.meshes.values()], false)
    const hit = hits[0]
    if (!hit) return null
    const normal = hit.face
      ? hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize()
      : new THREE.Vector3(0, 0, 1)
    return {
      id: hit.object.userData.id,
      kind: hit.object.userData.kind,
      point: [hit.point.x, hit.point.y, hit.point.z],
      normal: [normal.x, normal.y, normal.z],
      faceId: hit.faceIndex ?? -1,
    }
  }

  /** Where the cursor lands on a sketch plane, in that plane's 2D coordinates. */
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
    return [
      d.dot(new THREE.Vector3(...frame.xDir)),
      d.dot(new THREE.Vector3(...frame.yDir)),
    ]
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

    // --- corners ------------------------------------------------------------
    // Done in screen space and *before* any surface test, for two reasons: the
    // target is then the same size however far you are zoomed out, and corners
    // on the silhouette still work. Requiring a surface hit first meant the ray
    // grazed the mesh at exactly the corners people aim for, and five of a
    // box's eight were unpickable.
    const VERTEX_PX = 9
    let bestVertex: { bodyId: string; pos: Vec3; d: number } | null = null
    for (const [id, groups] of this.groups) {
      const seen = new Set<string>()
      for (let i = 0; i < groups.lines.length; i += 3) {
        const v = new THREE.Vector3(
          groups.lines[i],
          groups.lines[i + 1],
          groups.lines[i + 2],
        )
        const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`
        if (seen.has(key)) continue
        seen.add(key)
        const [sx, sy] = toScreen(v)
        const d = Math.hypot(sx - cx, sy - cy)
        if (d < VERTEX_PX && (!bestVertex || d < bestVertex.d)) {
          bestVertex = { bodyId: id, pos: [v.x, v.y, v.z], d }
        }
      }
    }
    if (bestVertex) {
      const p = bestVertex.pos
      return {
        bodyId: bestVertex.bodyId,
        kind: 'vertex',
        id: `v:${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}`,
        point: p,
      }
    }

    // Edges and faces still need a surface under the cursor, so that geometry
    // hidden behind the solid is not picked through it.
    const hit = this.raycaster.intersectObjects([...this.meshes.values()], false)[0]
    if (!hit) return null

    const bodyId = hit.object.userData.id as string
    const data = this.groups.get(bodyId)
    const point: Vec3 = [hit.point.x, hit.point.y, hit.point.z]
    if (!data) return null

    // --- edges --------------------------------------------------------------
    const outline = this.outlines.get(bodyId)
    if (outline) {
      const previous = this.raycaster.params.Line?.threshold
      this.raycaster.params.Line = { threshold: this.pixelSize(point) * 6 }
      const lineHit = this.raycaster.intersectObject(outline, false)[0]
      this.raycaster.params.Line = { threshold: previous ?? 1 }
      // Only accept an edge at least as near as the surface, so edges on the
      // far side are not picked straight through the solid.
      if (lineHit && lineHit.distance <= hit.distance + this.pixelSize(point) * 6) {
        const vertexIndex = lineHit.index ?? 0
        const group = data.edgeGroups.find(
          (g) => vertexIndex >= g.start && vertexIndex < g.start + g.count,
        )
        if (group) {
          return {
            bodyId,
            kind: 'edge',
            id: `e:${group.edgeId}`,
            point: this.edgeMidpoint(data, group),
            length: this.edgeLength(data, group),
          }
        }
      }
    }

    // --- faces --------------------------------------------------------------
    const triangle = (hit.faceIndex ?? 0) * 3
    const group = data.faceGroups.find(
      (g) => triangle >= g.start && triangle < g.start + g.count,
    )
    const normal = hit.face
      ? hit.face.normal
          .clone()
          .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
          .normalize()
      : new THREE.Vector3(0, 0, 1)
    return {
      bodyId,
      kind: 'face',
      id: `f:${group?.faceId ?? 'unknown'}`,
      point,
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
      (pick?.bodyId ?? null) === (this.hoverPick?.bodyId ?? null)
    if (same) return
    this.hoverPick = pick
    this.rebuildHighlight()
  }

  private rebuildHighlight() {
    const picks = this.selectedPicks
    for (const child of [...this.highlightGroup.children]) {
      this.highlightGroup.remove(child)
      ;(child as any).geometry?.dispose?.()
    }

    const faceTriangles: number[] = []
    const edgeVertices: number[] = []
    const cornerVertices: number[] = []
    const hoverFaces: number[] = []
    const hoverEdges: number[] = []
    const hoverCorners: number[] = []

    const alreadySelected = (p: SubPick) =>
      picks.some((s) => s.bodyId === p.bodyId && s.id === p.id)
    const all = this.hoverPick && !alreadySelected(this.hoverPick)
      ? [...picks, this.hoverPick]
      : picks

    for (const pick of all) {
      const isHover = pick === this.hoverPick && !alreadySelected(pick)
      const data = this.groups.get(pick.bodyId)
      if (!data) continue

      if (pick.kind === 'vertex') {
        ;(isHover ? hoverCorners : cornerVertices).push(...pick.point)
      } else if (pick.kind === 'edge') {
        const group = data.edgeGroups.find((g) => `e:${g.edgeId}` === pick.id)
        if (!group) continue
        const into = isHover ? hoverEdges : edgeVertices
        for (let i = group.start; i < group.start + group.count; i++) {
          into.push(data.lines[i * 3], data.lines[i * 3 + 1], data.lines[i * 3 + 2])
        }
      } else {
        const group = data.faceGroups.find((g) => `f:${g.faceId}` === pick.id)
        if (!group) continue
        const into = isHover ? hoverFaces : faceTriangles
        for (let i = group.start; i < group.start + group.count; i++) {
          const v = data.triangles[i] * 3
          into.push(data.vertices[v], data.vertices[v + 1], data.vertices[v + 2])
        }
      }
    }

    const drawFaces = (coords: number[], opacity: number) => {
    if (coords.length) {
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
          // Lift it off the surface it covers, or the two z-fight.
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      )
      mesh.renderOrder = 5
      this.highlightGroup.add(mesh)
    }
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
      this.highlightGroup.add(lines)
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
      this.highlightGroup.add(points)
    }

    // Hover is drawn fainter and smaller than a real selection, so the two are
    // never confused for one another.
    drawFaces(hoverFaces, 0.18)
    drawEdges(hoverEdges, HOVER)
    drawCorners(hoverCorners, HOVER, 8)
    drawFaces(faceTriangles, 0.45)
    drawEdges(edgeVertices, ACCENT)
    drawCorners(cornerVertices, ACCENT, 9)
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
    const direction = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize()
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
    this.camera.position
      .copy(centre)
      .addScaledVector(new THREE.Vector3(...frame.normal), distance)
    // Sketch x points up the screen rather than across it, which turns the
    // drawing a quarter turn anticlockwise to match the 3D view's home angle.
    this.camera.up.set(...frame.xDir)
    this.camera.lookAt(centre)
  }

  setStandardView(view: 'top' | 'front' | 'right' | 'iso') {
    const target = this.controls.target.clone()
    const distance = this.camera.position.distanceTo(target) || 400
    const dirs: Record<string, [Vec3, Vec3]> = {
      top: [[0, 0, 1], [0, 1, 0]],
      front: [[0, -1, 0], [0, 0, 1]],
      right: [[1, 0, 0], [0, 0, 1]],
      // Matches HOME_CAMERA, so pressing 3D returns to the view you started at.
      iso: [[-0.72, -0.6, 0.55], [0, 0, 1]],
    }
    const [dir, up] = dirs[view]
    this.camera.up.set(...up)
    this.camera.position.copy(target).addScaledVector(new THREE.Vector3(...dir).normalize(), distance)
    this.camera.lookAt(target)
  }

  setControlsEnabled(enabled: boolean) {
    this.controls.enableRotate = enabled
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
    this.renderer.render(this.scene, this.camera)

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
        next.some((l, i) => Math.abs(l.x - this.labels[i].x) > 0.5 || Math.abs(l.y - this.labels[i].y) > 0.5 || l.text !== this.labels[i].text)
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
