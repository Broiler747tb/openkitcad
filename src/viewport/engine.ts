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
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { FastenerGhost } from './ghosts'
import { createLook, disposeLook, type LookInstance, type LookPrototype } from './partLook'
import type { BodyMesh, Instance } from '../kernel/types'
import type { Matrix4 } from '../doc/types'
import type { Frame, Vec2, Vec3 } from '../core/math'
import { frameToWorld, NAMED_FRAMES, v3 } from '../core/math'
import type { Sketch2D } from '../sketch/types'
import { usePreferences, type Preferences } from '../doc/preferences'
import { entityPolylines } from '../sketch/curves'
import { regionAt, type RegionResult } from '../sketch/regions'
import { textProfileAt, type TextProfile } from '../sketch/text'
import { LIGHT_PALETTE, type ViewportPalette } from '../theme/palette'
import {
  DEFAULT_MOUSE_SCHEME,
  MOUSE_SCHEMES,
  modifiersOf,
  resolveDrag,
  resolveWheelGesture,
  type MouseScheme,
} from '../ui/mouse/schemes'

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
  lines: ReadonlyArray<{ id: string; a: Vec2; b: Vec2 }>
  regions: RegionResult
  texts: readonly TextProfile[]
  profiles: boolean
}

export interface DimensionSource {
  frame: Frame
  build: (pixel: number) => {
    lines: Vec2[][]
    labels: Array<{ id: string; text: string; at: Vec2 }>
  }
}

export interface ProfileHit {
  sketchId: string
  key: string
  distance: number
}

export interface JointGlyph {
  id: string
  frame: Matrix4
  tone: 'hover' | 'picked' | 'placed' | 'origin'
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

const PROFILE_LIFT = 0.02
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
  look?: LookInstance
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

const SKETCH_TESSELLATION_MM = 0.01

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
  private originPlaneGroup = new THREE.Group()
  private constructionGroup = new THREE.Group()
  private gridGroup = new THREE.Group()

  private geometries = new Map<string, GeometryEntry>()
  private objects = new Map<string, InstanceObject>()
  private highlightGroup = new THREE.Group()
  private clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)
  private sectionPlanes: THREE.Plane[] = []
  private sectionEnabled = false
  private slicePlane: THREE.Plane | null = null
  private sketchDisplay = { points: true }
  private dimmed = false
  private highlightKeys: { hovered: string | null; selected: string | null } = {
    hovered: null,
    selected: null,
  }

  private disposed = false
  private mouseScheme: MouseScheme = MOUSE_SCHEMES[DEFAULT_MOUSE_SCHEME]
  private navigationEnabled = true
  private rightDrag: { x: number; y: number; moved: boolean } | null = null
  private rightDragged = false
  private viewListeners = new Set<(view: number[]) => void>()
  private lastView = ''
  private viewTween: {
    from: THREE.Quaternion
    to: THREE.Quaternion
    target: THREE.Vector3
    distance: number
    start: number
  } | null = null
  private palette: ViewportPalette = LIGHT_PALETTE
  private hemisphere: THREE.HemisphereLight | null = null
  private lastGrid: { preferences: Preferences; frame: Frame | null } | null = null
  labels: ScreenLabel[] = []
  onLabels: ((labels: ScreenLabel[]) => void) | null = null
  onHandleScreens: ((handles: HandleScreen[]) => void) | null = null
  private handleGroup = new THREE.Group()
  private jointGroup = new THREE.Group()
  private jointGlyphs: JointGlyph[] = []
  private sketchOverlayGroup = new THREE.Group()
  private dimensionGroup = new THREE.Group()
  private dimensionSource: DimensionSource | null = null
  private dimensionPixel = 0
  private dimensionLabels: Array<{
    id: string
    text: string
    at: Vec3
    kind: ScreenLabel['kind']
  }> = []
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
    this.renderer.setClearColor(this.palette.background, 1)
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
        if (event.pointerType !== 'mouse') return
        const bit = event.button === 0 ? 1 : event.button === 1 ? 4 : event.button === 2 ? 2 : 0
        const action = resolveDrag(this.mouseScheme, bit, modifiersOf(event))
        const modified = event.ctrlKey || event.metaKey || event.shiftKey
        const mouse =
          action === 'orbit'
            ? modified
              ? THREE.MOUSE.PAN
              : THREE.MOUSE.ROTATE
            : action === 'pan'
              ? modified
                ? THREE.MOUSE.ROTATE
                : THREE.MOUSE.PAN
              : action === 'zoom'
                ? THREE.MOUSE.DOLLY
                : null
        this.controls.enableRotate = this.navigationEnabled
        this.controls.mouseButtons = {
          LEFT: event.button === 0 ? mouse : null,
          MIDDLE: event.button === 1 ? mouse : null,
          RIGHT: event.button === 2 ? mouse : null,
        } as typeof this.controls.mouseButtons
        this.rightDrag =
          event.button === 2 && action !== 'none'
            ? { x: event.clientX, y: event.clientY, moved: false }
            : null
        if (event.button === 2) this.rightDragged = false
      },
      { capture: true },
    )
    this.renderer.domElement.addEventListener('pointermove', (event) => {
      const drag = this.rightDrag
      if (!drag || drag.moved) return
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4) {
        drag.moved = true
        this.rightDragged = true
      }
    })

    // A touchpad has no middle button, and its two-finger scroll arrives here
    // as a wheel event that OrbitControls would dolly with. Take the gestures
    // that are not zoom before it sees them.
    this.renderer.domElement.addEventListener(
      'wheel',
      (event) => {
        if (!this.mouseScheme.gestures || !this.navigationEnabled) return
        const gesture = resolveWheelGesture(this.mouseScheme, event)
        if (gesture.action !== 'pan' && gesture.action !== 'orbit') return
        event.preventDefault()
        event.stopPropagation()
        if (gesture.action === 'pan') this.panByPixels(gesture.dx, gesture.dy)
        else this.orbitByPixels(gesture.dx, gesture.dy)
      },
      { capture: true, passive: false },
    )

    this.scene.add(
      this.solidGroup,
      this.sketchOverlayGroup,
      this.dimensionGroup,
      this.sketchGroup,
      this.overlayGroup,
      this.originPlaneGroup,
      this.constructionGroup,
      this.gridGroup,
      this.highlightGroup,
      this.handleGroup,
      this.jointGroup,
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
    this.hemisphere = new THREE.HemisphereLight(
      this.palette.hemisphereSky,
      this.palette.hemisphereGround,
      1.5,
    )
    this.scene.add(this.hemisphere)
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
    axes.add(axis([40, 0, 0], this.palette.axisX))
    axes.add(axis([0, 40, 0], this.palette.axisY))
    axes.add(axis([0, 0, 40], this.palette.axisZ))
    this.gridGroup.add(axes)
  }

  setPalette(palette: ViewportPalette) {
    this.palette = palette
    this.renderer.setClearColor(palette.background, 1)
    if (this.hemisphere) {
      this.hemisphere.color.setHex(palette.hemisphereSky)
      this.hemisphere.groundColor.setHex(palette.hemisphereGround)
    }
    for (const { outline, instance, look } of this.objects.values()) {
      ;(outline.material as THREE.LineBasicMaterial).color.setHex(
        instance.previewTool ? palette.previewCut : palette.bodyEdge,
      )
      look?.lines.color.setHex(palette.bodyEdge)
    }
    if (this.lastGrid) this.setGridPreferences(this.lastGrid.preferences, this.lastGrid.frame)
    this.paintProfiles()
    this.refreshDimensions()
    this.rebuildHighlight()
  }

  setGridPreferences(p: Preferences, frame: Frame | null) {
    this.lastGrid = { preferences: p, frame }
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
      add(minor, this.palette.gridMinor, p.gridOpacity)
      add(major, this.palette.gridMajor, Math.min(1, p.gridOpacity + 0.2))
    }
    if (p.axesVisible) {
      const size = p.gridExtent / 2
      add([-size, 0, 0, size, 0, 0], this.palette.axisX, 0.8)
      add([0, -size, 0, 0, size, 0], this.palette.axisY, 0.8)
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
    lookOf?: (instance: Instance) => LookPrototype | null,
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
            color: tool ? this.palette.previewCut : this.palette.bodyEdge,
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

      const prototype = lookOf?.(instance) ?? null
      if (entry.look && entry.look.key !== prototype?.key) this.dropLook(entry)
      if (prototype && !entry.look) {
        const look = createLook(prototype, {
          clippingPlanes: this.sectionPlanes,
          envMap: this.environment(),
          edgeColour: this.palette.bodyEdge,
        })
        look.group.matrixAutoUpdate = false
        for (const material of look.materials) this.applyLookOpacity(material)
        this.solidGroup.add(look.group)
        entry.look = look
      }
      if (entry.look) {
        entry.look.group.matrix.fromArray(instance.matrix)
        entry.look.group.matrixWorldNeedsUpdate = true
      }
      entry.mesh.visible = !entry.look
      entry.outline.visible = !entry.look
    }

    for (const [id, entry] of [...this.objects]) {
      if (seen.has(id)) continue
      this.dropLook(entry)
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

  private dropLook(entry: InstanceObject) {
    if (!entry.look) return
    this.solidGroup.remove(entry.look.group)
    disposeLook(entry.look)
    entry.look = undefined
  }

  private envMap: THREE.Texture | null | undefined

  private environment(): THREE.Texture | null {
    if (this.envMap !== undefined) return this.envMap
    try {
      const generator = new THREE.PMREMGenerator(this.renderer)
      this.envMap = generator.fromScene(new RoomEnvironment(), 0.04).texture
      generator.dispose()
    } catch {
      this.envMap = null
    }
    return this.envMap
  }

  private applyLookOpacity(material: THREE.MeshStandardMaterial) {
    const base = (material.userData.baseOpacity as number | undefined) ?? 1
    material.transparent = this.dimmed || base < 1
    material.opacity = base * (this.dimmed ? 0.28 : 1)
    material.depthWrite = !this.dimmed && base >= 1
  }

  setHighlight(hovered: string | null, selected: string | null) {
    this.highlightKeys = { hovered, selected }
    this.applyHighlight()
  }

  private applyHighlight() {
    const { hovered, selected } = this.highlightKeys
    for (const { mesh, instance, look } of this.objects.values()) {
      const [colour, intensity] = matchesKey(instance, selected)
        ? [this.palette.selection, 0.32]
        : matchesKey(instance, hovered)
          ? [this.palette.selectionDim, 0.16]
          : [0x000000, 0]
      for (const material of [
        mesh.material as THREE.MeshStandardMaterial,
        ...(look?.materials ?? []),
      ]) {
        material.emissive.setHex(colour)
        material.emissiveIntensity = intensity
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
    for (const { mesh, instance, look } of this.objects.values()) {
      if (instance.previewTool) continue
      this.applyOpacity(mesh.material as THREE.MeshStandardMaterial)
      for (const material of look?.materials ?? []) this.applyLookOpacity(material)
      if (look) look.lines.opacity = this.dimmed ? 0.1 : 0.3
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
    this.sectionEnabled = enabled
    this.applyClipping()
  }

  setSlice(frame: Frame | null) {
    this.slicePlane = frame
      ? new THREE.Plane().setFromNormalAndCoplanarPoint(
          new THREE.Vector3(...frame.normal).negate(),
          new THREE.Vector3(...frame.origin),
        )
      : null
    this.applyClipping()
  }

  private applyClipping() {
    this.sectionPlanes = [
      ...(this.sectionEnabled ? [this.clipPlane] : []),
      ...(this.slicePlane ? [this.slicePlane] : []),
    ]
    for (const { mesh, outline, look } of this.objects.values()) {
      ;(mesh.material as THREE.Material).clippingPlanes = this.sectionPlanes
      ;(outline.material as THREE.Material).clippingPlanes = this.sectionPlanes
      for (const material of look?.materials ?? []) material.clippingPlanes = this.sectionPlanes
      if (look) look.lines.clippingPlanes = this.sectionPlanes
    }
  }

  setSketchDisplay(display: { points: boolean }) {
    this.sketchDisplay = display
  }

  // -------------------------------------------------------------------------
  // Sketch overlay
  // -------------------------------------------------------------------------

  setDimensionSource(source: DimensionSource | null) {
    this.dimensionSource = source
    this.refreshDimensions()
  }

  refreshDimensions() {
    for (const child of [...this.dimensionGroup.children]) {
      this.dimensionGroup.remove(child)
      ;(child as THREE.LineSegments).geometry?.dispose?.()
      ;((child as THREE.LineSegments).material as THREE.Material | undefined)?.dispose?.()
    }
    const source = this.dimensionSource
    if (!source) {
      this.dimensionLabels = []
      this.dimensionPixel = 0
      return
    }
    const pixel = this.pixelSize(source.frame.origin)
    this.dimensionPixel = pixel
    const { lines, labels } = source.build(pixel)
    const points: THREE.Vector3[] = []
    for (const chain of lines) {
      for (let i = 0; i + 1 < chain.length; i++) {
        points.push(
          new THREE.Vector3(...frameToWorld(source.frame, chain[i])),
          new THREE.Vector3(...frameToWorld(source.frame, chain[i + 1])),
        )
      }
    }
    if (points.length) {
      const segments = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: this.palette.dimension, depthTest: false }),
      )
      segments.renderOrder = 12
      this.dimensionGroup.add(segments)
    }
    this.dimensionLabels = labels.map((label) => ({
      id: label.id,
      text: label.text,
      at: frameToWorld(source.frame, label.at),
      kind: 'dimension' as const,
    }))
  }

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
    preview: { curves: Vec2[][]; construction?: Vec2[][] } | null,
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
      for (const polyline of entityPolylines(entity, pts, SKETCH_TESSELLATION_MM)) {
        for (let i = 0; i + 1 < polyline.length; i++) {
          target.push(to3(polyline[i]), to3(polyline[i + 1]))
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

    addLines(solid, this.palette.sketchLine)
    addLines(undefined3, this.palette.sketchFree)
    addLines(accent, this.palette.selection)
    addLines(construction, this.palette.sketchConstruction, true)

    if (preview) {
      const segments = (chains: Vec2[][]) => {
        const points: THREE.Vector3[] = []
        for (const chain of chains) {
          for (let i = 0; i + 1 < chain.length; i++) points.push(to3(chain[i]), to3(chain[i + 1]))
        }
        return points
      }
      addLines(segments(preview.curves), this.palette.selection)
      addLines(segments(preview.construction ?? []), this.palette.sketchConstruction, true)
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
    if (this.sketchDisplay.points || highlight.points.length) {
      addPoints(this.sketchDisplay.points ? locked : [], this.palette.sketchPoint, 6)
      addPoints(this.sketchDisplay.points ? free : [], this.palette.sketchFree, 7)
    }
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
          new THREE.LineBasicMaterial({ color: this.palette.overlayLine }),
        )
        line.renderOrder = 4
        this.sketchOverlayGroup.add(line)
      }
      const dashed = segments(overlay.construction)
      if (dashed.length) {
        const line = new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(dashed),
          new THREE.LineDashedMaterial({
            color: this.palette.overlayConstruction,
            dashSize: 1.6,
            gapSize: 1.2,
          }),
        )
        line.computeLineDistances()
        line.renderOrder = 4
        this.sketchOverlayGroup.add(line)
      }
      if (!overlay.profiles) continue
      const fillGeometry = (fills: ReadonlyArray<{ contour: Vec2[]; holes: Vec2[][] }>) => {
        const positions: number[] = []
        const indices: number[] = []
        for (const fill of fills) {
          const contour = fill.contour.map((p) => new THREE.Vector2(p[0], p[1]))
          const holes = fill.holes.map((hole) => hole.map((p) => new THREE.Vector2(p[0], p[1])))
          let triangles: number[][]
          try {
            triangles = THREE.ShapeUtils.triangulateShape(contour, holes)
          } catch {
            continue
          }
          const base = positions.length / 3
          for (const p of [...contour, ...holes.flat()]) {
            const world = to3([p.x, p.y])
            positions.push(world.x, world.y, world.z)
          }
          for (const triangle of triangles) indices.push(...triangle.map((i) => i + base))
        }
        if (!indices.length) return null
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        geometry.setIndex(indices)
        return geometry
      }
      const profileAreas = [
        ...overlay.regions.regions.map((region) => ({
          key: region.key,
          text: false,
          fills: [
            {
              contour: region.outer.polygon,
              holes: region.holes.map((hole) => [...hole.polygon].reverse()),
            },
          ],
        })),
        ...overlay.texts.map((text) => ({ key: text.key, text: true, fills: text.fills })),
      ]
      for (const area of profileAreas) {
        const geometry = fillGeometry(area.fills)
        if (!geometry) continue
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshBasicMaterial({
            color: this.palette.profileIdle,
            transparent: true,
            opacity: 0.32,
            side: THREE.DoubleSide,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: area.text ? -3 : -2,
            polygonOffsetUnits: area.text ? -3 : -2,
          }),
        )
        mesh.renderOrder = area.text ? 4 : 3
        const id = `${overlay.id}|${area.key}`
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
      material.color.setHex(
        picked
          ? this.palette.profilePicked
          : hovered
            ? this.palette.profileHover
            : this.palette.profileIdle,
      )
      material.opacity = picked ? 0.5 : hovered ? 0.45 : 0.32
    }
  }

  pickOverlayLine(
    clientX: number,
    clientY: number,
    tolerance = 7,
  ): { sketchId: string; entityId: string } | null {
    this.raycaster.setFromCamera(this.pointerToNdc(clientX, clientY), this.camera)
    const ray = this.raycaster.ray
    let best: { sketchId: string; entityId: string; gap: number } | null = null
    for (const overlay of this.sketchOverlays) {
      if (!overlay.lines.length) continue
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
      const limit = tolerance * this.pixelSize([point.x, point.y, point.z])
      for (const line of overlay.lines) {
        const ab: Vec2 = [line.b[0] - line.a[0], line.b[1] - line.a[1]]
        const length = ab[0] * ab[0] + ab[1] * ab[1]
        if (length < 1e-18) continue
        const t = Math.min(
          1,
          Math.max(0, ((local[0] - line.a[0]) * ab[0] + (local[1] - line.a[1]) * ab[1]) / length),
        )
        const gap = Math.hypot(
          local[0] - (line.a[0] + ab[0] * t),
          local[1] - (line.a[1] + ab[1] * t),
        )
        if (gap <= limit && (!best || gap < best.gap)) {
          best = { sketchId: overlay.id, entityId: line.id, gap }
        }
      }
    }
    return best ? { sketchId: best.sketchId, entityId: best.entityId } : null
  }

  pickProfile(clientX: number, clientY: number): ProfileHit | null {
    this.raycaster.setFromCamera(this.pointerToNdc(clientX, clientY), this.camera)
    const ray = this.raycaster.ray
    let best: ProfileHit | null = null
    for (const overlay of this.sketchOverlays) {
      if (!overlay.profiles || (!overlay.regions.regions.length && !overlay.texts.length)) continue
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
      const text = textProfileAt(
        overlay.texts,
        local,
        4 * this.pixelSize([point.x, point.y, point.z]),
      )
      const key = text?.key ?? regionAt(overlay.regions, local)?.key
      if (!key) continue
      const distance = point.distanceTo(ray.origin)
      if (!best || distance < best.distance) {
        best = { sketchId: overlay.id, key, distance }
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

  setOriginPlanes(visible: boolean) {
    for (const child of [...this.originPlaneGroup.children]) {
      this.originPlaneGroup.remove(child)
      child.traverse((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose()
        ;(mesh.material as THREE.Material | undefined)?.dispose()
      })
    }
    if (!visible) return
    const size = this.planeSize()
    for (const name of ['XY', 'XZ', 'YZ'] as const) {
      const frame = NAMED_FRAMES[name]
      const geometry = new THREE.PlaneGeometry(size, size)
      geometry.translate(size / 2, size / 2, 0)
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: this.palette.originPlane,
          transparent: true,
          opacity: 0.2,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      )
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: this.palette.originPlaneEdge }),
      )
      mesh.add(outline)
      mesh.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(
          new THREE.Vector3(...frame.xDir),
          new THREE.Vector3(...frame.yDir),
          new THREE.Vector3(...frame.normal),
        ),
      )
      mesh.userData.originPlane = name
      mesh.renderOrder = 2
      this.originPlaneGroup.add(mesh)
    }
  }

  private planeSize(): number {
    const box = new THREE.Box3().setFromObject(this.solidGroup)
    const reach = box.isEmpty()
      ? 0
      : Math.max(...box.min.toArray().map(Math.abs), ...box.max.toArray().map(Math.abs))
    return Math.max(30, reach * 1.15)
  }

  setConstructionPlanes(planes: ReadonlyArray<{ id: string; frame: Frame }>) {
    for (const child of [...this.constructionGroup.children]) {
      this.constructionGroup.remove(child)
      child.traverse((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose()
        ;(mesh.material as THREE.Material | undefined)?.dispose()
      })
    }
    const size = this.planeSize() * 0.8
    for (const { id, frame } of planes) {
      const geometry = new THREE.PlaneGeometry(size, size)
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: this.palette.originPlane,
          transparent: true,
          opacity: 0.16,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      )
      mesh.add(
        new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry),
          new THREE.LineBasicMaterial({ color: this.palette.originPlaneEdge }),
        ),
      )
      mesh.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(
          new THREE.Vector3(...frame.xDir),
          new THREE.Vector3(...frame.yDir),
          new THREE.Vector3(...frame.normal),
        ),
      )
      mesh.position.set(...frame.origin)
      mesh.userData.constructionPlane = id
      mesh.renderOrder = 2
      this.constructionGroup.add(mesh)
    }
  }

  setConstructionPlaneState(hovered: string | null, selected: string | null) {
    for (const child of this.constructionGroup.children) {
      const id = child.userData.constructionPlane as string
      const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial
      material.opacity = id === selected ? 0.4 : id === hovered ? 0.32 : 0.16
      const edge = child.children[0] as THREE.LineSegments | undefined
      ;(edge?.material as THREE.LineBasicMaterial | undefined)?.color.setHex(
        id === selected ? this.palette.selection : this.palette.originPlaneEdge,
      )
    }
  }

  pickConstructionPlane(clientX: number, clientY: number): string | null {
    if (!this.constructionGroup.children.length) return null
    this.raycaster.setFromCamera(this.pointerToNdc(clientX, clientY), this.camera)
    const hit = this.raycaster.intersectObjects(this.constructionGroup.children, false)[0]
    return (hit?.object.userData.constructionPlane as string | undefined) ?? null
  }

  pickOriginPlane(clientX: number, clientY: number): 'XY' | 'XZ' | 'YZ' | null {
    if (!this.originPlaneGroup.children.length) return null
    this.raycaster.setFromCamera(this.pointerToNdc(clientX, clientY), this.camera)
    const hit = this.raycaster.intersectObjects(this.originPlaneGroup.children, false)[0]
    return (hit?.object.userData.originPlane as 'XY' | 'XZ' | 'YZ' | undefined) ?? null
  }

  setOriginPlaneHover(name: 'XY' | 'XZ' | 'YZ' | null) {
    for (const child of this.originPlaneGroup.children) {
      const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial
      material.opacity = child.userData.originPlane === name ? 0.45 : 0.2
    }
  }

  isFlatFace(hit: PickResult): boolean {
    const entry = this.objects.get(hit.instanceId)
    const data = entry ? this.geometries.get(entry.instance.meshKey)?.data : undefined
    const triangle = hit.faceId * 3
    const group = data?.faceGroups.find(
      (candidate) => triangle >= candidate.start && triangle < candidate.start + candidate.count,
    )
    if (!data || !group) return false
    const { triangles, vertices } = data
    const normalOf = (at: number) => {
      const [a, b, c] = [triangles[at] * 3, triangles[at + 1] * 3, triangles[at + 2] * 3]
      const u = [
        vertices[b] - vertices[a],
        vertices[b + 1] - vertices[a + 1],
        vertices[b + 2] - vertices[a + 2],
      ]
      const w = [
        vertices[c] - vertices[a],
        vertices[c + 1] - vertices[a + 1],
        vertices[c + 2] - vertices[a + 2],
      ]
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
      const length = Math.hypot(n[0], n[1], n[2])
      return length > 1e-12 ? n.map((value) => value / length) : null
    }
    let reference: number[] | null = null
    for (let at = group.start; at < group.start + group.count; at += 3) {
      const normal = normalOf(at)
      if (!normal) continue
      if (!reference) reference = normal
      else if (
        normal[0] * reference[0] + normal[1] * reference[1] + normal[2] * reference[2] <
        0.9999
      )
        return false
    }
    return !!reference
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
      color: this.palette.sketchPlane,
      transparent: true,
      opacity: this.palette.sketchPlaneOpacity,
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
      const colour = handle.id === hot ? this.palette.handleHot : this.palette.handle
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

  setJointGlyphs(glyphs: JointGlyph[]) {
    this.jointGlyphs = glyphs
    for (const child of [...this.jointGroup.children]) {
      this.jointGroup.remove(child)
      child.traverse((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose?.()
        ;(mesh.material as THREE.Material | undefined)?.dispose?.()
      })
    }
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const size = new THREE.Vector3()
    for (const glyph of glyphs) {
      const colour =
        glyph.tone === 'hover'
          ? this.palette.handleHot
          : glyph.tone === 'picked'
            ? this.palette.selection
            : glyph.tone === 'origin'
              ? this.palette.overlayConstruction
              : this.palette.overlayLine
      const paint = (color: number, opacity = 1) =>
        new THREE.MeshBasicMaterial({
          color,
          depthTest: false,
          transparent: true,
          opacity,
          side: THREE.DoubleSide,
        })
      const group = new THREE.Group()
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(6, 32),
        paint(this.palette.background, 0.85),
      )
      const ring = new THREE.Mesh(new THREE.RingGeometry(5.5, 8.5, 32), paint(colour))
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 1.1, 24, 8).rotateX(Math.PI / 2).translate(0, 0, 12),
        paint(colour),
      )
      const tip = new THREE.Mesh(
        new THREE.ConeGeometry(3.5, 9, 16).rotateX(Math.PI / 2).translate(0, 0, 28),
        paint(colour),
      )
      const tick = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.9, 12, 6).rotateZ(-Math.PI / 2).translate(14.5, 0, 0),
        paint(colour),
      )
      group.add(disc, ring, shaft, tip, tick)
      group.children.forEach((child, index) => (child.renderOrder = 22 + index))
      new THREE.Matrix4().fromArray(glyph.frame).decompose(position, quaternion, size)
      group.position.copy(position)
      group.quaternion.copy(quaternion)
      group.userData = { scaleAt: [position.x, position.y, position.z], jointId: glyph.id }
      this.jointGroup.add(group)
    }
    this.scaleHandles()
  }

  pickJointGlyph(clientX: number, clientY: number, tolerance = 14): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    let best: { id: string; d: number } | null = null
    for (const glyph of this.jointGlyphs) {
      const screen = this.screenOf([glyph.frame[12], glyph.frame[13], glyph.frame[14]])
      if (!screen) continue
      const d = Math.hypot(screen[0] + rect.left - clientX, screen[1] + rect.top - clientY)
      if (d <= tolerance && (!best || d < best.d)) best = { id: glyph.id, d }
    }
    return best?.id ?? null
  }

  private scaleHandles() {
    for (const child of [...this.handleGroup.children, ...this.jointGroup.children]) {
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

  private dropGhost: { group: THREE.Group; key: string } | null = null

  setDropGhost(
    ghost: {
      key: string
      bounds: [number, number, number, number, number, number]
      matrix: Matrix4
    } | null,
  ) {
    if (this.dropGhost && this.dropGhost.key !== ghost?.key) {
      this.overlayGroup.remove(this.dropGhost.group)
      this.dropGhost.group.traverse((child) => {
        const drawn = child as THREE.Mesh
        drawn.geometry?.dispose()
        ;(drawn.material as THREE.Material | undefined)?.dispose()
      })
      this.dropGhost = null
    }
    if (!ghost) return
    if (!this.dropGhost) {
      const [x0, y0, z0, x1, y1, z1] = ghost.bounds
      const geometry = new THREE.BoxGeometry(
        Math.max(x1 - x0, 0.01),
        Math.max(y1 - y0, 0.01),
        Math.max(z1 - z0, 0.01),
      ).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
      const fill = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: this.palette.selection,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
        }),
      )
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: this.palette.selection }),
      )
      fill.renderOrder = 4
      edges.renderOrder = 5
      const group = new THREE.Group()
      group.add(fill, edges)
      group.matrixAutoUpdate = false
      this.overlayGroup.add(group)
      this.dropGhost = { group, key: ghost.key }
    }
    this.dropGhost.group.matrix.fromArray(ghost.matrix)
    this.dropGhost.group.matrixWorldNeedsUpdate = true
  }

  dropTarget(clientX: number, clientY: number): { point: Vec3; normal?: Vec3 } | null {
    const hit = this.pick(clientX, clientY)
    const ray = this.raycaster.ray
    if (hit) {
      const [nx, ny, nz] = hit.normal
      const away = nx * ray.direction.x + ny * ray.direction.y + nz * ray.direction.z > 0
      return { point: hit.point, normal: away ? [-nx, -ny, -nz] : hit.normal }
    }
    const point = new THREE.Vector3()
    if (!ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), point)) return null
    return { point: [point.x, point.y, point.z] }
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
  pickSub(
    clientX: number,
    clientY: number,
    options: { catalogue?: boolean; vertices?: boolean } = {},
  ): SubPick | null {
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
      (entry) =>
        (entry.instance.kind === 'body' || !!options.catalogue) && !entry.instance.previewTool,
    )

    const VERTEX_PX = 9
    let bestVertex: { entry: InstanceObject; pos: Vec3; d: number } | null = null
    const world = new THREE.Vector3()
    for (const entry of options.vertices === false ? [] : bodies) {
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
            color: this.palette.selection,
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
      drawEdges(bucket.hoverEdges, this.palette.hover)
      drawCorners(bucket.hoverCorners, this.palette.hover, 8)
      drawFaces(bucket.faces, 0.45)
      drawEdges(bucket.edges, this.palette.selection)
      drawCorners(bucket.corners, this.palette.selection, 9)
      this.highlightGroup.add(holder)
    }
  }

  toScreen(at: Vec3): [number, number] | null {
    this.camera.updateMatrixWorld()
    const v = new THREE.Vector3(...at).project(this.camera)
    if (v.z > 1) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height]
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
    this.camera.up.set(...frame.yDir)
    this.camera.lookAt(centre)
  }

  setStandardView(view: string) {
    const target = this.controls.target.clone()
    const distance = this.camera.position.distanceTo(target) || 400
    const dirs: Record<string, [Vec3, Vec3]> = {
      top: [
        [0, 0, 1],
        [0, 1, 0],
      ],
      bottom: [
        [0, 0, -1],
        [0, -1, 0],
      ],
      front: [
        [0, -1, 0],
        [0, 0, 1],
      ],
      back: [
        [0, 1, 0],
        [0, 0, 1],
      ],
      right: [
        [1, 0, 0],
        [0, 0, 1],
      ],
      left: [
        [-1, 0, 0],
        [0, 0, 1],
      ],
      iso: [
        [-0.72, -0.6, 0.55],
        [0, 0, 1],
      ],
    }
    const chosen = dirs[view]
    if (!chosen) return
    const [dir, up] = chosen
    const eye = target.clone().addScaledVector(new THREE.Vector3(...dir).normalize(), distance)
    const goal = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(...up)),
    )
    this.viewTween = {
      from: this.camera.quaternion.clone(),
      to: goal,
      target,
      distance,
      start: performance.now(),
    }
  }

  subscribeView(listener: (view: number[]) => void): () => void {
    this.viewListeners.add(listener)
    listener(this.viewRotation())
    return () => {
      this.viewListeners.delete(listener)
    }
  }

  private viewRotation(): number[] {
    this.camera.updateMatrixWorld()
    const e = this.camera.matrixWorldInverse.elements
    return [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]]
  }

  private stepViewTween() {
    const tween = this.viewTween
    if (!tween) return false
    const t = Math.min(1, (performance.now() - tween.start) / 260)
    const eased = t * t * (3 - 2 * t)
    const q = tween.from.clone().slerp(tween.to, eased)
    this.camera.quaternion.copy(q)
    this.camera.position
      .copy(tween.target)
      .add(new THREE.Vector3(0, 0, tween.distance).applyQuaternion(q))
    this.camera.up.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(q))
    if (t >= 1) {
      this.viewTween = null
      this.camera.lookAt(tween.target)
    }
    return true
  }

  setControlsEnabled(enabled: boolean) {
    this.navigationEnabled = enabled
    this.controls.enableRotate = enabled
  }

  setMouseScheme(scheme: MouseScheme) {
    this.mouseScheme = scheme
    this.controls.zoomSpeed = scheme.wheelForward === 'out' ? -1 : 1
  }

  consumeRightDrag(): boolean {
    const dragged = this.rightDragged
    this.rightDragged = false
    this.rightDrag = null
    return dragged
  }

  setFingerNavigation(orbit: boolean) {
    this.controls.touches.ONE = orbit ? THREE.TOUCH.ROTATE : THREE.TOUCH.PAN
    this.controls.enableRotate = orbit
  }

  /**
   * Slide the camera and what it looks at across the screen plane, in pixels.
   *
   * The scale is the height the camera covers at the distance of the target,
   * so a gesture moves the model by the number of pixels it travelled however
   * far away the model is.
   */
  private panByPixels(dx: number, dy: number) {
    const height = this.renderer.domElement.clientHeight || 1
    const reach = this.camera.position.distanceTo(this.controls.target)
    const scale = (2 * reach * Math.tan((this.camera.fov / 2) * THREE.MathUtils.DEG2RAD)) / height
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0)
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1)
    const move = right.multiplyScalar(dx * scale).add(up.multiplyScalar(-dy * scale))
    this.camera.position.add(move)
    this.controls.target.add(move)
  }

  /**
   * Swing the camera around what it is looking at, in pixels of gesture.
   *
   * The camera is Z-up, so the offset is rotated into the Y-up frame spherical
   * coordinates assume and back again, which is what OrbitControls does with
   * its own drag.
   */
  private orbitByPixels(dx: number, dy: number) {
    const height = this.renderer.domElement.clientHeight || 1
    const toYUp = new THREE.Quaternion().setFromUnitVectors(
      this.camera.up,
      new THREE.Vector3(0, 1, 0),
    )
    const offset = this.camera.position.clone().sub(this.controls.target).applyQuaternion(toYUp)
    const spherical = new THREE.Spherical().setFromVector3(offset)
    spherical.theta -= (2 * Math.PI * dx) / height
    spherical.phi -= (2 * Math.PI * dy) / height
    spherical.phi = THREE.MathUtils.clamp(spherical.phi, 1e-6, Math.PI - 1e-6)
    this.camera.position
      .copy(this.controls.target)
      .add(offset.setFromSpherical(spherical).applyQuaternion(toYUp.invert()))
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
    if (!this.stepViewTween()) this.controls.update()
    if (this.viewListeners.size) {
      const view = this.viewRotation()
      const key = view.map((v) => v.toFixed(4)).join(',')
      if (key !== this.lastView) {
        this.lastView = key
        for (const listener of this.viewListeners) listener(view)
      }
    }
    this.scaleHandles()
    if (this.dimensionSource && this.dimensionPixel > 0) {
      const pixel = this.pixelSize(this.dimensionSource.frame.origin)
      if (Math.abs(pixel - this.dimensionPixel) / this.dimensionPixel > 0.04)
        this.refreshDimensions()
    }
    this.renderer.render(this.scene, this.camera)
    this.projectHandles()

    if (this.onLabels) {
      const rect = this.renderer.domElement.getBoundingClientRect()
      const next: ScreenLabel[] = []
      for (const label of [...this.worldLabels, ...this.dimensionLabels]) {
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
    for (const entry of this.objects.values()) this.dropLook(entry)
    this.envMap?.dispose()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
