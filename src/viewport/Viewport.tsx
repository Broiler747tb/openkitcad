import { useEffect, useMemo, useRef, useState } from 'react'
import {
  elementKey,
  ViewportEngine,
  type HandleScreen,
  type ScreenLabel,
  type SketchOverlay,
  type SubPick,
} from './engine'
import { resolveHandles, type ActiveHandle } from './handles'
import { entityCentre, pointLookup, tessellate } from '../sketch/curves'
import { cachedRegions } from '../sketch/regions'
import { findInput } from '../ui/command/state'
import { formatAngle, formatLength } from '../ui/command/units'
import { CommandHost } from '../ui/command/CommandHost'
import { useCommand } from '../ui/command/session'
import {
  acceptedKinds,
  bodyPick,
  commandPicks,
  elementPick,
  offerPick,
  pickSketchId,
  profilePick,
} from '../ui/command/picks'
import {
  activeSketchFeature,
  bodyInstance,
  componentMatrix,
  DEFAULT_BODY_COLOUR,
  newId,
  occurrencePathOf,
  useStore,
} from '../doc/store'
import { frameFromPlaneRefLocal, transformFrame } from '../doc/planes'
import { findSnap, hitTestSketch, toggleSelection } from '../sketch/inference'
import {
  anchorFromSnap,
  buildTool,
  canFinish,
  continueFrom,
  emptyToolState,
  lockField,
  placeAnchor,
  remember,
} from '../sketch/tools/session'
import { isSketchTool, sketchTool } from '../sketch/tools/specs'
import type {
  SketchToolSpec,
  ToolAnchor,
  ToolBuild,
  ToolField,
  ToolFrame,
  ToolState,
} from '../sketch/tools/types'
import { parseAngle, parseInteger, parseLength } from '../ui/command/units'
import { runConstraintTool } from '../ui/sketchConstraints'
import { circularPatternAt, sketchEdit } from '../ui/sketchModify'
import { breakEntity, extendEntity, mirrorAbout, trimEntity } from '../sketch/modify'
import { findCorner, maxFilletRadius } from '../sketch/corner'
import type { ConstraintToolId } from '../sketch/constraintTools'
import { sketchActions } from '../sketch/actions'
import { isAndroidApp, usePenMode } from '../platform/android'
import { SketchMenu } from '../ui/SketchMenu'
import { chooseAction } from '../ui/ActionDialog'
import { ObjectMenu, objectActions, trailingMove, type PickedFace } from '../ui/ObjectMenu'
import { fastenerGhosts } from './ghosts'
import { saveDocument } from '../doc/persist'
import { usePreferences, snapOptions } from '../doc/preferences'
import { fmt, frameToWorld, v2, type Frame, type Vec2, type Vec3 } from '../core/math'
import { CONSTRAINT_LABELS } from '../sketch/types'
import type { Constraint, NewConstraint, Sketch2D } from '../sketch/types'
import type { Body, Component, Feature, LengthUnit, Matrix4, Occurrence } from '../doc/types'
import type { Instance } from '../kernel/types'
import {
  activeFeatures,
  featureCreatesBodies,
  featureModifiesBodies,
  findBody,
  findComponent,
  findOccurrence,
  invertRigidMatrix,
  isElementRef,
  multiplyMatrices,
  pathMatrix,
  remapElementName,
  transformPoint,
} from '../doc/model'
import { poseMatrix, poseOf } from '../doc/placement'
import { CATEGORY_COLOUR, getPart } from '../catalogue'
import { lengthLabel } from '../core/units'

/** Snap radius in screen pixels. */
const SNAP_PX = 11
/** How far the pointer may travel and still count as a click rather than a drag. */
const CLICK_SLOP_PX = 4

/** Press and hold this long with a finger or pen to get the right-click menu. */
const HOLD_MS = 480
/** A finger wanders more than a mouse, so a hold gets more room than a click. */
const HOLD_SLOP_PX = 12

/** Gizmo output is snapped to whole millimetres; keep the stored value tidy. */
const round = (n: number) => Math.round(n * 1000) / 1000

const NEGATIVE_COLOUR = '#4a5560'
const PREVIEW_CUT_COLOUR = '#d4473d'

interface DimensionPrompt {
  x: number
  y: number
  value: string
  unit: string
  apply: (value: number) => void
}

type Clipboard =
  | { kind: 'body'; body: Body; features: Feature[] }
  | { kind: 'occurrence'; occurrence: Occurrence; component: Component }

let clipboard: Clipboard | null = null

/** Pasted copies land beside the original, not on top of it. */
const PASTE_OFFSET = 10

function bodyFeatures(bodyId: string): Feature[] {
  const doc = useStore.getState().doc
  const ids = new Set<string>()
  for (const feature of doc.timeline) {
    const touched = new Set([...featureCreatesBodies(feature), ...featureModifiesBodies(feature)])
    if (!touched.has(bodyId) || touched.size !== 1 || feature.kind === 'combine') continue
    ids.add(feature.id)
    if (feature.kind === 'extrude' || feature.kind === 'revolve') ids.add(feature.sketchId)
  }
  return structuredClone(doc.timeline.filter((feature) => ids.has(feature.id)))
}

function copySelection(cut: boolean): boolean {
  const store = useStore.getState()
  const { selection, doc } = store
  if (selection.kind === 'body' && selection.id) {
    const found = findBody(doc, selection.id)
    if (!found) return false
    clipboard = {
      kind: 'body',
      body: structuredClone(found.body),
      features: bodyFeatures(found.body.id),
    }
    if (cut) {
      store.removeBody(found.body.id)
      store.select({ kind: 'none' })
    }
    store.setStatus(`${cut ? 'Cut' : 'Copied'} "${found.body.name}".`)
    return true
  }
  if (selection.kind === 'occurrence' && selection.id) {
    const occurrence = findOccurrence(doc, selection.id)
    const component = occurrence ? findComponent(doc, occurrence.componentId) : undefined
    if (!occurrence || !component) return false
    clipboard = {
      kind: 'occurrence',
      occurrence: structuredClone(occurrence),
      component: structuredClone(component),
    }
    if (cut) {
      store.removeOccurrence(occurrence.id)
      store.select({ kind: 'none' })
    }
    store.setStatus(`${cut ? 'Cut' : 'Copied'} "${occurrence.name}".`)
    return true
  }
  return false
}

/**
 * Delete whatever is picked inside a sketch.
 *
 * Entities first, then loose points, because deleting an entity takes its
 * constraints with it and a point that was only holding that entity up would
 * otherwise be deleted out from under it.
 */
function deleteSketchSelection(): void {
  const store = useStore.getState()
  const picked = store.sketchSelection
  for (const target of picked) {
    if (target.kind === 'entity') {
      store.applySketchAction({ kind: 'deleteEntity', entityId: target.id })
    }
  }
  for (const target of picked) {
    if (target.kind === 'point') {
      store.applySketchAction({ kind: 'deletePoint', pointId: target.id })
    }
  }
  for (const target of picked) {
    if (target.kind === 'constraint') {
      store.applySketchAction({ kind: 'deleteConstraint', constraintId: target.id })
    }
  }
  store.setSketchSelection([])
}

function pasteClipboard(): boolean {
  if (!clipboard) return false
  const store = useStore.getState()

  if (clipboard.kind === 'occurrence') {
    const { occurrence, component } = clipboard
    if (findOccurrence(store.doc, occurrence.id)) {
      return !!store.linkedCopy(occurrence.id)
    }
    if (component.source.kind !== 'catalogue') {
      store.setStatus(`"${occurrence.name}" was deleted, so there is nothing left to paste.`)
      return false
    }
    const pose = poseOf(occurrence.transform)
    const id = store.insertCatalogue(component.source.partId)
    const inserted = findOccurrence(useStore.getState().doc, id)
    if (inserted) {
      store.updateOccurrence(id, {
        transform: poseMatrix({
          ...pose,
          position: [
            pose.position[0] + PASTE_OFFSET,
            pose.position[1] + PASTE_OFFSET,
            pose.position[2],
          ],
        }),
        negative: occurrence.negative,
      })
      if (component.source.overrides)
        store.updateComponent(inserted.componentId, { source: component.source })
    }
    store.select({ kind: 'occurrence', id })
    return true
  }

  const { body, features } = clipboard
  const bodyId = newId('body')
  const remap = new Map<string, string>([[body.id, bodyId]])
  for (const feature of features) remap.set(feature.id, newId('f'))
  const rename = (value: unknown): unknown => {
    if (typeof value === 'string') return remap.get(value) ?? value
    if (Array.isArray(value)) return value.map(rename)
    if (value && typeof value === 'object') {
      const renamed = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rename(v)]))
      return isElementRef(value)
        ? { ...renamed, name: remapElementName(value.name, remap) }
        : renamed
    }
    return value
  }
  const componentId = features[0]?.componentId ?? store.doc.rootComponentId
  if (!findComponent(store.doc, componentId) || !features.length) {
    store.setStatus(`There is nothing left of "${body.name}" to paste.`)
    return false
  }
  store.addFeatures(
    [
      ...features.map((feature) => rename(feature) as Feature),
      {
        id: newId('move'),
        kind: 'move',
        name: 'Move',
        componentId,
        bodyIds: [bodyId],
        offset: [PASTE_OFFSET, PASTE_OFFSET, 0],
        rotation: [0, 0, 0],
      },
    ],
    { [bodyId]: { name: `${body.name} copy`, colour: body.colour } },
  )
  store.select({ kind: 'body', id: bodyId })
  store.setStatus(`Pasted a copy of "${body.name}".`)
  return true
}

export function Viewport() {
  const preferences = usePreferences((s) => s.values)
  const mountRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<ViewportEngine | null>(null)
  const toolRef = useRef<ToolState>(emptyToolState())
  const toolCursorRef = useRef<ToolAnchor | null>(null)
  const headsUpRef = useRef<HeadsUp>({ fields: [], focus: null, text: '' })
  const [headsUp, setHeadsUpState] = useState<HeadsUp>({ fields: [], focus: null, text: '' })
  const setHeadsUp = (next: HeadsUp) => {
    headsUpRef.current = next
    setHeadsUpState(next)
  }
  const toolActionsRef = useRef<ToolActions | null>(null)
  const draggingRef = useRef<{ pointId: string; moved: boolean } | null>(null)
  const penContactRef = useRef(false)
  const downRef = useRef<{ x: number; y: number } | null>(null)
  /**
   * Long-press stands in for right-click on a phone.
   *
   * It raises the same contextmenu event a mouse would, so the whole menu -
   * object or sketch, face under the finger and all - runs through one path.
   * Anything else would be a second menu to keep in step with the first.
   */
  const holdRef = useRef<number | null>(null)
  const cancelHold = () => {
    if (holdRef.current !== null) {
      clearTimeout(holdRef.current)
      holdRef.current = null
    }
  }
  const [labels, setLabels] = useState<ScreenLabel[]>([])
  const [handleScreens, setHandleScreens] = useState<HandleScreen[]>([])
  const [hotHandle, setHotHandle] = useState<string | null>(null)
  const handleDragRef = useRef<ActiveHandle | null>(null)
  const [cursorHint, setCursorHint] = useState<{ x: number; y: number; text: string } | null>(null)
  const [prompt, setPrompt] = useState<DimensionPrompt | null>(null)
  useEffect(() => {
    if (!prompt) return
    chooseAction({
      id: 'dimension-value',
      label: 'Set dimension',
      prompt: { label: 'Value', initial: Number(prompt.value), unit: prompt.unit },
      run: (value) => prompt.apply(value),
    })
    setPrompt(null)
  }, [prompt])
  const [, forceRender] = useState(0)

  const committedInstances = useStore((s) => s.instances)
  const committedMeshes = useStore((s) => s.meshes)
  const commandPreview = useCommand((s) => s.preview)
  const commandSession = useCommand((s) => s.session)
  const instances = commandPreview?.instances ?? committedInstances
  const meshes = useMemo(
    () =>
      commandPreview ? new Map([...committedMeshes, ...commandPreview.meshes]) : committedMeshes,
    [committedMeshes, commandPreview],
  )
  const showPlacements = useStore((s) => s.showPlacements)
  const hovered = useStore((s) => s.hovered)
  const selection = useStore((s) => s.selection)
  const section = useStore((s) => s.section)
  const tool = useStore((s) => s.tool)
  const fingerMode = usePenMode((s) => s.fingerMode)
  const activeSketch = useStore((s) => s.activeSketch)
  const doc = useStore((s) => s.doc)
  const gizmoMode = useStore((s) => s.gizmoMode)
  const showFasteners = useStore((s) => s.showFasteners)
  const gizmoBase = useRef<{ anchor: Vec3; offset: Vec3; inverse: Matrix4 } | null>(null)
  const gizmoParent = useRef<Matrix4 | null>(null)
  const sketchSelection = useStore((s) => s.sketchSelection)
  const sketchStatus = useStore((s) => s.sketchStatus)
  const subSelection = useStore((s) => s.subSelection)
  const [menu, setMenu] = useState<{ x: number; y: number; cursor: Vec2 } | null>(null)
  const [objectMenu, setObjectMenu] = useState<{
    x: number
    y: number
    picked: PickedFace | null
  } | null>(null)

  // Memoised so they keep a stable identity across the renders the animation
  // loop triggers. Recomputing them on every render made the sketch-redraw
  // effect fire each frame, which fed straight back into another render.
  const sketchFeature = useMemo(
    () => (activeSketch ? activeSketchFeature(useStore.getState()) : null),
    [doc, activeSketch],
  )
  const planes = useStore((s) => s.planes)
  const sketchPlane = sketchFeature
    ? frameFromPlaneRefLocal(sketchFeature.plane, planes.get(sketchFeature.id))
    : null
  const planeKey = sketchPlane ? JSON.stringify(sketchPlane) : ''
  const frame: Frame | null = useMemo(
    () =>
      sketchFeature && sketchPlane
        ? transformFrame(
            sketchPlane,
            componentMatrix(useStore.getState().doc, sketchFeature.componentId),
          )
        : null,
    [sketchFeature, planeKey],
  )

  // --- engine lifecycle ----------------------------------------------------
  useEffect(() => {
    if (!mountRef.current) return
    const engine = new ViewportEngine(mountRef.current)
    engineRef.current = engine
    engine.onLabels = setLabels
    engine.onHandleScreens = setHandleScreens
    if (import.meta.env.DEV) (window as any).__okcEngine = engine

    engine.onGizmoChange = (pose) => {
      const store = useStore.getState()
      const tidy = (a: number) => Math.round(a * 10) / 10

      if (store.selection.kind === 'body' && store.selection.id) {
        const move = trailingMove(store.doc, store.selection.id)
        const base = gizmoBase.current
        if (!move || !base) return
        const local = transformPoint(base.inverse, pose.position)
        store.beginTransient()
        store.updateFeature(
          move.id,
          {
            offset: [
              round(base.offset[0] + local[0] - base.anchor[0]),
              round(base.offset[1] + local[1] - base.anchor[1]),
              round(base.offset[2] + local[2] - base.anchor[2]),
            ],
            rotation: [
              tidy(pose.rotationXyz[0]),
              tidy(pose.rotationXyz[1]),
              tidy(pose.rotationXyz[2]),
            ],
          } as Partial<Feature>,
          { transient: true },
        )
        return
      }

      if (store.selection.kind !== 'occurrence' || !store.selection.id) return
      const parent = gizmoParent.current
      if (!parent) return
      const local = poseOf(multiplyMatrices(invertRigidMatrix(parent), pose.matrix))
      store.beginTransient()
      store.updateOccurrence(
        store.selection.id,
        {
          transform: poseMatrix({
            position: [
              round(local.position[0]),
              round(local.position[1]),
              round(local.position[2]),
            ],
            turn: (((Math.round(local.turn * 10) / 10) % 360) + 360) % 360,
            flipped: local.flipped,
          }),
        },
        { transient: true },
      )
    }
    engine.onGizmoRelease = () => useStore.getState().endTransient()
    const observer = new ResizeObserver(() => engine.resize())
    observer.observe(mountRef.current)

    const onView = (e: Event) => engine.setStandardView((e as CustomEvent).detail)
    const onFit = () => engine.frameAll()
    window.addEventListener('okc:view', onView)
    window.addEventListener('okc:fit', onFit)

    return () => {
      observer.disconnect()
      window.removeEventListener('okc:view', onView)
      window.removeEventListener('okc:fit', onFit)
      engine.dispose()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    const colourOf = (instance: Instance) => {
      if (instance.previewTool) return PREVIEW_CUT_COLOUR
      if (instance.negative) return NEGATIVE_COLOUR
      if (instance.kind === 'catalogue') {
        const component = findComponent(doc, instance.componentId)
        const part =
          component?.source.kind === 'catalogue' ? getPart(component.source.partId) : undefined
        return part ? CATEGORY_COLOUR[part.category] : '#7f878f'
      }
      return findBody(doc, instance.bodyId)?.body.colour ?? DEFAULT_BODY_COLOUR
    }
    engine.setScene(instances, meshes, colourOf, showPlacements)
  }, [instances, meshes, showPlacements, doc])

  // Ghosts of the screws and inserts the holes were drilled for.
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    // Hidden while sketching: the whole point of being in a sketch is to see
    // the outline, and a row of screws standing on it is in the way.
    engine.setFastenerGhosts(
      showFasteners && !activeSketch ? fastenerGhosts(doc, instances, meshes, planes) : [],
    )
  }, [doc, instances, meshes, planes, showFasteners, activeSketch])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    if (activeSketch) {
      engine.setGizmo(null, gizmoMode)
      return
    }
    if (selection.kind === 'body' && selection.id) {
      const move = trailingMove(doc, selection.id)
      const state = useStore.getState()
      const instance =
        (selection.instanceId && instances.find((i) => i.id === selection.instanceId)) ||
        bodyInstance(state, selection.id)
      const bounds = instance ? meshes.get(instance.meshKey)?.bounds : undefined
      if (move && instance && bounds) {
        const centre: Vec3 = [
          (bounds[0] + bounds[3]) / 2,
          (bounds[1] + bounds[4]) / 2,
          (bounds[2] + bounds[5]) / 2,
        ]
        if (!engine.isGizmoDragging()) {
          gizmoBase.current = {
            anchor: centre,
            offset: move.offset,
            inverse: invertRigidMatrix(instance.matrix),
          }
        }
        engine.setGizmo(
          { position: transformPoint(instance.matrix, centre), rotationXyz: move.rotation },
          gizmoMode,
        )
        return
      }
    }
    if (!engine.isGizmoDragging()) gizmoBase.current = null
    if (selection.kind === 'occurrence' && selection.id) {
      const path = occurrencePathOf(doc, selection.id, selection.instanceId)
      const world = path ? pathMatrix(doc, path) : null
      const parent = path ? pathMatrix(doc, path.slice(0, -1)) : null
      if (world && parent) {
        if (!engine.isGizmoDragging()) gizmoParent.current = parent
        engine.setGizmo({ position: [world[12], world[13], world[14]], matrix: world }, gizmoMode)
        return
      }
    }
    engine.setGizmo(null, gizmoMode)
  }, [selection, doc, instances, meshes, gizmoMode, activeSketch])

  // Frame whenever geometry appears out of nothing: opening a document, or
  // turning the first sketch into a solid. Waiting for the shapes rather than
  // reacting to the button press is what makes this land on the real geometry,
  // since the kernel rebuild is asynchronous.
  const hadShapesRef = useRef(false)
  useEffect(() => {
    const has = instances.length > 0
    if (has && !hadShapesRef.current) engineRef.current?.frameAll()
    hadShapesRef.current = has
  }, [instances])

  useEffect(() => {
    engineRef.current?.setHighlight(hovered, selection.instanceId ?? selection.id ?? null)
  }, [hovered, selection])

  useEffect(() => {
    const picks: SubPick[] = commandSession
      ? commandPicks().flatMap((pick) => {
          const ref = pick.face ?? pick.edge
          const instance =
            pick.instanceId ?? instances.find((candidate) => candidate.bodyId === ref?.bodyId)?.id
          if (!ref || !instance) return []
          return [
            {
              instanceId: instance,
              bodyId: ref.bodyId,
              kind: ref.kind,
              id: elementKey(ref.kind === 'face' ? 'f' : 'e', ref.name, -1),
              name: ref.name,
              point: [0, 0, 0],
            },
          ]
        })
      : subSelection
    engineRef.current?.setSubHighlight(activeSketch ? [] : picks)
  }, [subSelection, activeSketch, instances, commandSession])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.setSketchDisplay({ points: preferences.sketchShowPoints })
    engine.setSlice(activeSketch && preferences.sketchSlice ? frame : null)
  }, [preferences.sketchShowPoints, preferences.sketchSlice, activeSketch, frame])

  useEffect(() => {
    const look = () => {
      if (frame) engineRef.current?.lookAtFrame(frame)
    }
    window.addEventListener('okc:look-at', look)
    return () => window.removeEventListener('okc:look-at', look)
  }, [frame])

  const pickedSketchKey = commandSession
    ? [...new Set(commandPicks().map(pickSketchId))].sort().join(',')
    : ''
  const showProfile = preferences.sketchShowProfile
  const sketchOverlays = useMemo((): SketchOverlay[] => {
    const referenced = new Set(pickedSketchKey ? pickedSketchKey.split(',') : [])
    return activeFeatures(doc).flatMap((feature): SketchOverlay[] => {
      if (feature.kind !== 'sketch') return []
      if (feature.id === activeSketch?.featureId) {
        const local = frameFromPlaneRefLocal(feature.plane, planes.get(feature.id))
        if (!local || !showProfile) return []
        return [
          {
            id: feature.id,
            frame: transformFrame(local, componentMatrix(doc, feature.componentId)),
            curves: [],
            construction: [],
            regions: cachedRegions(feature.sketch),
            profiles: true,
          },
        ]
      }
      if (!feature.visible && !referenced.has(feature.id)) return []
      const local = frameFromPlaneRefLocal(feature.plane, planes.get(feature.id))
      if (!local) return []
      const pts = pointLookup(feature.sketch)
      const curves: Vec2[][] = []
      const construction: Vec2[][] = []
      for (const entity of feature.sketch.entities) {
        if (entity.kind === 'point') continue
        ;(entity.construction ? construction : curves).push(tessellate(entity, pts, 0.02))
      }
      return [
        {
          id: feature.id,
          frame: transformFrame(local, componentMatrix(doc, feature.componentId)),
          curves,
          construction,
          regions: cachedRegions(feature.sketch),
          profiles: true,
        },
      ]
    })
  }, [doc, planes, activeSketch?.featureId, pickedSketchKey, showProfile])
  useEffect(() => {
    engineRef.current?.setSketchOverlays(sketchOverlays)
  }, [sketchOverlays])

  const pickedProfiles = useMemo(() => {
    const ids = new Set<string>()
    if (!commandSession) return ids
    for (const pick of commandPicks()) {
      if (pick.profile) ids.add(pick.id)
      else if (pick.kind === 'sketch') {
        const feature = doc.timeline.find((candidate) => candidate.id === pick.id)
        if (feature?.kind !== 'sketch') continue
        for (const region of cachedRegions(feature.sketch).regions) {
          if (region.solid) ids.add(`${feature.id}|${region.key}`)
        }
      }
    }
    return ids
  }, [commandSession, doc])
  const [hoveredProfile, setHoveredProfile] = useState<string | null>(null)
  useEffect(() => {
    engineRef.current?.setProfileHighlight(pickedProfiles, hoveredProfile)
  }, [pickedProfiles, hoveredProfile, sketchOverlays])

  const activeHandles = useMemo(
    () =>
      commandSession && !activeSketch
        ? resolveHandles(commandSession, doc, committedInstances, committedMeshes)
        : [],
    [commandSession, activeSketch, doc, committedInstances, committedMeshes, planes],
  )
  useEffect(() => {
    engineRef.current?.setHandles(activeHandles, hotHandle)
  }, [activeHandles, hotHandle])

  function dragHandle(handle: ActiveHandle, e: React.PointerEvent) {
    const engine = engineRef.current
    const session = useCommand.getState().session
    const input = session ? findInput(session.spec, handle.input) : undefined
    if (!engine || !input || (input.kind !== 'length' && input.kind !== 'angle')) return
    const preferences = usePreferences.getState().values
    const step = e.altKey ? 0 : handle.kind === 'arc' ? preferences.angleSnap : preferences.moveSnap
    let value =
      handle.kind === 'arc'
        ? engine.arcAngle(e.clientX, e.clientY, handle)
        : engine.arrowParameter(e.clientX, e.clientY, handle.origin, handle.direction)
    if (value === null) return
    if (handle.kind === 'arrow') value /= handle.scale
    if (step) value = Math.round(value / step) * step
    if (input.min !== undefined) {
      value = Math.max(value, input.exclusiveMin ? input.min + (step || 0.01) : input.min)
    }
    if (input.max !== undefined) value = Math.min(value, input.max)
    useCommand.getState().dispatch({
      type: 'text',
      id: handle.input,
      text: input.kind === 'angle' ? formatAngle(value) : formatLength(value, doc.units),
    })
  }

  useEffect(() => {
    engineRef.current?.setSection(section.enabled, section.axis, section.position, section.flipped)
  }, [section])

  useEffect(() => {
    engineRef.current?.setOpacity(!!activeSketch)
    engineRef.current?.setSketchPlaneHint(frame)
    if (activeSketch && frame) engineRef.current?.lookAtFrame(frame)
    if (!activeSketch) {
      engineRef.current?.clearSketch()
      resetTool()
    }
    // Only when entering or leaving sketch mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSketch?.featureId])

  // A gesture belongs to one tool and one sketch only.
  useEffect(() => {
    resetTool()
    draggingRef.current = null
    engineRef.current?.setControlsEnabled(true)
  }, [tool, activeSketch?.featureId])

  useEffect(() => {
    if (isAndroidApp)
      engineRef.current?.setFingerNavigation(!activeSketch && fingerMode === 'orbit')
  }, [fingerMode, activeSketch])

  useEffect(() => {
    const cancel = () => {
      toolActionsRef.current?.reset()
      draggingRef.current = null
      cancelHold()
      engineRef.current?.setControlsEnabled(true)
      useStore.getState().setTool('select')
      setMenu(null)
      setObjectMenu(null)
      forceRender((n) => n + 1)
    }
    window.addEventListener('okc:cancel', cancel)
    return () => window.removeEventListener('okc:cancel', cancel)
  }, [])

  // Redraw the sketch whenever it changes.
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    if (!sketchFeature || !frame) return
    engine.setSketch(
      sketchFeature.sketch,
      frame,
      null,
      selectionHighlight(sketchSelection),
      looseGeometry(sketchFeature.sketch, sketchStatus),
    )
    engine.setLabels(sketchLabels(sketchFeature.sketch, frame, doc.units))
  }, [doc, sketchFeature, frame, sketchSelection, sketchStatus, tool])

  useEffect(() => {
    engineRef.current?.setGridPreferences(preferences, frame)
  }, [preferences, frame])

  // --- helpers -------------------------------------------------------------

  const toleranceAt = (): number => {
    const engine = engineRef.current
    if (!engine || !frame) return 1
    return engine.pixelSize(frame.origin) * usePreferences.getState().values.snapRadius
  }

  const pointerToSketch = (e: { clientX: number; clientY: number }): Vec2 | null => {
    const engine = engineRef.current
    if (!engine || !frame) return null
    return engine.pickOnPlane(e.clientX, e.clientY, frame)
  }

  /** Reuse a snapped point, or add a new one. */
  function ensurePoint(sketch: Sketch2D, pos: Vec2, snapId: string | null): string {
    if (snapId && sketch.points.some((p) => p.id === snapId)) return snapId
    const id = newId('p')
    sketch.points.push({ id, x: pos[0], y: pos[1] })
    return id
  }

  function pushConstraint(sketch: Sketch2D, c: NewConstraint) {
    sketch.constraints.push({ ...c, id: newId('c') } as Constraint)
  }

  useEffect(() => {
    const input = (event: Event) => {
      if (!isSketchTool(tool) || !activeSketch) return
      const { x, y, relative } = (event as CustomEvent<{ x: number; y: number; relative: boolean }>)
        .detail
      if (!Number.isFinite(x) || !Number.isFinite(y)) return
      const base = relative ? toolRef.current.anchors.at(-1)?.point : null
      placeAt(freeToolAnchor([x + (base?.[0] ?? 0), y + (base?.[1] ?? 0)]))
    }
    window.addEventListener('okc:coordinate', input)
    return () => window.removeEventListener('okc:coordinate', input)
  }, [tool, activeSketch, frame])

  // --- sketch drawing ------------------------------------------------------

  function resetTool() {
    toolRef.current = emptyToolState()
    toolCursorRef.current = null
    if (headsUpRef.current.fields.length || headsUpRef.current.text) {
      setHeadsUp({ fields: [], focus: null, text: '' })
    }
  }

  function snapAnchor(sketch: Sketch2D, cursor: Vec2, bypass: boolean): ToolAnchor {
    const snap = findSnap(sketch, cursor, {
      ...snapOptions(toleranceAt(), bypass),
      from: toolRef.current.anchors.at(-1)?.point,
    })
    return anchorFromSnap(snap)
  }

  function showToolFrame(sketch: Sketch2D, spec: SketchToolSpec, anchor: ToolAnchor): ToolFrame {
    const engine = engineRef.current
    const toolFrame = spec.frame(toolRef.current, anchor, sketch)
    toolRef.current = remember(toolRef.current, toolFrame)
    if (!engine || !frame) return toolFrame
    const store = useStore.getState()
    const highlight = selectionHighlight(store.sketchSelection)
    if (anchor.snapToPointId) highlight.points.push(anchor.snapToPointId)
    if (anchor.onEntityId) highlight.entities.push(anchor.onEntityId)
    engine.setSketch(
      sketch,
      frame,
      { curves: toolFrame.curves, construction: toolFrame.construction },
      highlight,
      looseGeometry(sketch, store.sketchStatus),
    )
    const fields = toolFrame.fields.flatMap((field) => {
      const at = engine.toScreen(frameToWorld(frame, field.at))
      return at ? [{ ...field, x: at[0], y: at[1] }] : []
    })
    const current = headsUpRef.current
    const focus =
      current.focus && fields.some((field) => field.id === current.focus)
        ? current.focus
        : (fields[0]?.id ?? null)
    setHeadsUp({ fields, focus, text: focus === current.focus ? current.text : '' })
    return toolFrame
  }

  function refreshTool() {
    const spec = sketchTool(useStore.getState().tool)
    const sketch = activeSketchFeature(useStore.getState())?.sketch
    const anchor = toolCursorRef.current
    if (spec && sketch && anchor) showToolFrame(sketch, spec, anchor)
  }

  function commitTool(spec: SketchToolSpec, state: ToolState) {
    const store = useStore.getState()
    const sketch = activeSketchFeature(store)?.sketch
    if (!sketch) return
    let serial = 0
    const trial = buildTool(
      spec,
      structuredClone(sketch),
      state,
      (prefix) => `${prefix}~${serial++}`,
    )
    if (trial.error) {
      if (trial.error !== 'same point') store.setStatus(trial.error)
      resetTool()
      return
    }
    let build: ToolBuild = {}
    store.editSketch((draft) => {
      build = buildTool(spec, draft, state, newId)
    })
    store.solveActiveSketch()
    const next = activeSketchFeature(useStore.getState())?.sketch
    toolRef.current =
      spec.chain && next
        ? continueFrom(next, build.chainFrom, state.origin ?? build.chainStart)
        : emptyToolState()
    setHeadsUp({ fields: [], focus: null, text: '' })
    refreshTool()
  }

  function finishOpenTool(): boolean {
    const spec = sketchTool(useStore.getState().tool)
    if (!spec || spec.clicks !== 0) return false
    if (canFinish(spec, toolRef.current)) commitTool(spec, toolRef.current)
    else resetTool()
    return true
  }

  function placeAt(anchor: ToolAnchor) {
    const store = useStore.getState()
    const spec = sketchTool(store.tool)
    const sketch = activeSketchFeature(store)?.sketch
    if (!spec || !sketch) return
    const state = toolRef.current
    const toolFrame = spec.frame(state, anchor, sketch)
    if (toolFrame.blocked) {
      store.setStatus(toolFrame.blocked)
      return
    }
    const previous = state.anchors.at(-1)
    if (
      spec.clicks === 0 &&
      previous &&
      v2.dist(previous.point, toolFrame.anchor.point) <= toleranceAt() * 0.25
    ) {
      finishOpenTool()
      return
    }
    const placed = placeAnchor(spec, remember(state, toolFrame), toolFrame)
    if (spec.chain && placed.state.anchors.length === 2) {
      const [a, b] = placed.state.anchors
      if (
        (a.snapToPointId && a.snapToPointId === b.snapToPointId) ||
        v2.dist(a.point, b.point) < 1e-9
      ) {
        resetTool()
        return
      }
    }
    if (placed.complete) {
      commitTool(spec, placed.state)
      return
    }
    toolRef.current = placed.state
    setHeadsUp({ ...headsUpRef.current, focus: null, text: '' })
    showToolFrame(sketch, spec, toolFrame.anchor)
    store.setStatus(spec.prompts[Math.min(placed.state.anchors.length, spec.prompts.length - 1)])
  }

  function lockFocused(): boolean {
    const hud = headsUpRef.current
    const field = hud.fields.find((candidate) => candidate.id === hud.focus)
    if (!field || !hud.text.trim()) return true
    const store = useStore.getState()
    let value: number
    try {
      value =
        field.kind === 'length'
          ? parseLength(hud.text, store.doc.units)
          : field.kind === 'angle'
            ? parseAngle(hud.text)
            : parseInteger(hud.text)
    } catch (error) {
      store.setStatus((error as Error).message)
      return false
    }
    if (!Number.isFinite(value) || (field.kind !== 'angle' && value <= 0)) {
      store.setStatus(`${field.label} has to be more than zero.`)
      return false
    }
    toolRef.current = lockField(toolRef.current, field.id, value)
    setHeadsUp({ ...hud, text: '' })
    return true
  }

  toolActionsRef.current = {
    reset: resetTool,
    refresh: refreshTool,
    place: () => {
      if (toolCursorRef.current) placeAt(toolCursorRef.current)
    },
    finish: finishOpenTool,
    lock: lockFocused,
    focusNext: () => {
      const hud = headsUpRef.current
      if (!hud.fields.length) return
      const index = hud.fields.findIndex((field) => field.id === hud.focus)
      setHeadsUp({ ...hud, focus: hud.fields[(index + 1) % hud.fields.length].id, text: '' })
    },
    type: (text: string) => setHeadsUp({ ...headsUpRef.current, text }),
  }

  // --- pointer handling ----------------------------------------------------

  const onPointerMove = (e: React.PointerEvent) => {
    const engine = engineRef.current
    if (!engine) return
    const store = useStore.getState()

    if (activeSketch && frame) {
      const cursor = pointerToSketch(e)
      const sketch = activeSketchFeature(store)?.sketch
      if (!cursor || !sketch) return

      if (draggingRef.current) {
        const down = downRef.current
        // Pressing on a corner might be the start of a drag or might just be a
        // click to select it. Wait until the pointer actually travels before
        // committing to a drag, otherwise a corner can never be selected.
        if (
          !draggingRef.current.moved &&
          down &&
          Math.hypot(e.clientX - down.x, e.clientY - down.y) <= CLICK_SLOP_PX
        ) {
          return
        }
        if (!draggingRef.current.moved) {
          draggingRef.current.moved = true
          store.beginTransient()
        }
        const dragged = findSnap(sketch, cursor, {
          ...snapOptions(toleranceAt(), e.altKey),
          exclude: [draggingRef.current.pointId],
          edges: false,
          midpoints: false,
        })
        store.solveActiveSketch({
          point: draggingRef.current.pointId,
          x: dragged.point[0],
          y: dragged.point[1],
        })
        return
      }

      if (['trim', 'extend', 'break', 'mirror'].includes(tool)) {
        const hit = hitTestSketch(sketch, cursor, toleranceAt(), false)
        setCursorHint({ x: e.clientX, y: e.clientY, text: MODIFY_HINTS[tool] ?? '' })
        engine.setSketch(
          sketch,
          frame,
          null,
          selectionHighlight(hit ? [hit] : []),
          looseGeometry(sketch, store.sketchStatus),
        )
        return
      }

      const anchor = snapAnchor(sketch, cursor, e.altKey)
      const spec = sketchTool(tool)
      if (!spec) {
        const snap = findSnap(sketch, cursor, snapOptions(toleranceAt(), e.altKey))
        setCursorHint(snap.hint ? { x: e.clientX, y: e.clientY, text: snap.hint } : null)
        const highlight = selectionHighlight(store.sketchSelection)
        if (snap.snapToPointId) highlight.points.push(snap.snapToPointId)
        if (snap.onEntityId) highlight.entities.push(snap.onEntityId)
        engine.setSketch(sketch, frame, null, highlight, looseGeometry(sketch, store.sketchStatus))
        return
      }
      toolCursorRef.current = anchor
      const toolFrame = showToolFrame(sketch, spec, anchor)
      const hint = toolFrame.blocked ?? (toolRef.current.anchors.length ? null : spec.prompts[0])
      const snapHint = findSnap(sketch, cursor, {
        ...snapOptions(toleranceAt(), e.altKey),
        from: toolRef.current.anchors.at(-1)?.point,
      }).hint
      const text = toolFrame.blocked ?? snapHint ?? hint
      setCursorHint(text ? { x: e.clientX, y: e.clientY, text } : null)
      return
    }

    if (handleDragRef.current) {
      dragHandle(handleDragRef.current, e)
      return
    }
    const hot = activeHandles.length ? engine.pickHandle(e.clientX, e.clientY) : null
    if (hot !== hotHandle) setHotHandle(hot)
    const profile =
      !hot && useCommand.getState().session && acceptedKinds().has('profile')
        ? engine.pickProfile(e.clientX, e.clientY)
        : null
    const profileId = profile ? `${profile.sketchId}|${profile.key}` : null
    if (profileId !== hoveredProfile) setHoveredProfile(profileId)
    if (profile) {
      if (store.hovered !== null) store.setHovered(null)
      engine.setHoverPick(null)
      return
    }
    const hit = engine.pick(e.clientX, e.clientY)
    if ((hit?.instanceId ?? null) !== store.hovered) store.setHovered(hit?.instanceId ?? null)
    engine.setHoverPick(engine.pickSub(e.clientX, e.clientY))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const engine = engineRef.current
    if (!engine) return
    const store = useStore.getState()

    if (activeSketch && frame) {
      const cursor = pointerToSketch(e)
      const sketch = activeSketchFeature(store)?.sketch
      if (!cursor || !sketch) return

      if (tool === 'select') {
        // Grab a point to drag it.
        const snap = findSnap(sketch, cursor, { tolerance: toleranceAt(), gridStep: 0 })
        if (snap.snapToPointId && snap.snapToPointId !== 'origin') {
          draggingRef.current = { pointId: snap.snapToPointId, moved: false }
          downRef.current = { x: e.clientX, y: e.clientY }
          engine.setControlsEnabled(false)
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          return
        }
        // Not on a point: select whatever is under the cursor so the
        // right-click menu has something to work with. Shift adds to it.
        const hit = hitTestSketch(sketch, cursor, toleranceAt())
        store.setSketchSelection(
          hit ? (e.shiftKey ? toggleSelection(store.sketchSelection, hit) : [hit]) : [],
        )
        return
      }

      if (tool === 'dimension') {
        openDimensionFor(cursor, e.clientX, e.clientY)
        return
      }

      if (tool === 'trim' || tool === 'extend' || tool === 'break') {
        const hit = hitTestSketch(sketch, cursor, toleranceAt(), false)
        const label = tool === 'trim' ? 'Trim' : tool === 'extend' ? 'Extend' : 'Break'
        if (hit?.kind !== 'entity') {
          store.setStatus(`${label}: click a curve.`)
          return
        }
        const operation =
          tool === 'trim' ? trimEntity : tool === 'extend' ? extendEntity : breakEntity
        store.setSketchSelection([])
        sketchEdit(label, (draft) => operation(draft, hit.id, cursor, newId))
        return
      }

      if (tool === 'sketchFillet') {
        const hit = hitTestSketch(sketch, cursor, toleranceAt())
        if (hit?.kind === 'point') {
          const corner = findCorner(sketch, hit.id)
          if (!corner) {
            store.setStatus('Fillet: pick a corner where two lines or arcs meet.')
            return
          }
          const suggested = Math.max(
            0.5,
            Math.round(Math.min(maxFilletRadius(corner) * 0.35, 5) * 10) / 10,
          )
          setPrompt({
            x: e.clientX,
            y: e.clientY,
            value: String(suggested),
            unit: 'mm',
            apply: (radius) =>
              useStore
                .getState()
                .applySketchAction({ kind: 'filletCorner', pointId: hit.id, radius }),
          })
          return
        }
        if (hit?.kind === 'entity') {
          const picks = store.sketchSelection.filter((t) => t.kind === 'entity' && t.id !== hit.id)
          if (!picks.length) {
            store.setSketchSelection([hit])
            store.setStatus('Fillet: pick the second curve.')
            return
          }
          const first = picks[picks.length - 1]
          store.setSketchSelection([])
          setPrompt({
            x: e.clientX,
            y: e.clientY,
            value: '3',
            unit: 'mm',
            apply: (radius) =>
              useStore.getState().applySketchAction({
                kind: 'filletBetween',
                aId: first.id,
                bId: hit.id,
                radius,
                cursor,
              }),
          })
          return
        }
        store.setStatus('Fillet: pick a corner, or two curves.')
        return
      }

      if (tool === 'mirror') {
        const hit = hitTestSketch(sketch, cursor, toleranceAt(), false)
        const objects = store.sketchSelection.filter((t) => t.kind === 'entity').map((t) => t.id)
        if (!objects.length) {
          store.setStatus('Mirror: select the geometry to mirror first, then choose Mirror.')
          return
        }
        const line =
          hit?.kind === 'entity' ? sketch.entities.find((x) => x.id === hit.id) : undefined
        if (line?.kind !== 'line') {
          store.setStatus('Mirror: click the line to mirror about.')
          return
        }
        if (sketchEdit('Mirror', (draft) => mirrorAbout(draft, objects, line.id, newId))) {
          store.setSketchSelection([])
          store.setTool('select')
        }
        return
      }

      if (tool === 'circularPattern') {
        const objects = store.sketchSelection.filter((t) => t.kind === 'entity')
        if (!objects.length) {
          store.setStatus('Circular Pattern: select the geometry to repeat first.')
          return
        }
        const snap = findSnap(sketch, cursor, snapOptions(toleranceAt(), e.altKey))
        chooseAction(circularPatternAt(snap.point))
        store.setTool('select')
        return
      }

      if (tool.startsWith('constrain:')) {
        const hit = hitTestSketch(sketch, cursor, toleranceAt())
        if (!hit) {
          store.setSketchSelection([])
          return
        }
        const picks = store.sketchSelection.filter((target) => target.kind !== 'constraint')
        const already = picks.some((target) => target.kind === hit.kind && target.id === hit.id)
        runConstraintTool(
          tool.slice('constrain:'.length) as ConstraintToolId,
          already
            ? picks.filter((t) => !(t.kind === hit.kind && t.id === hit.id))
            : [...picks, hit],
        )
        return
      }
      if (!isSketchTool(tool)) return
      engine.setControlsEnabled(false)
      placeAt(snapAnchor(sketch, cursor, e.altKey))
      return
    }

    const grabbed = activeHandles.find(
      (handle) => handle.id === engine.pickHandle(e.clientX, e.clientY),
    )
    if (grabbed) {
      handleDragRef.current = grabbed
      engine.setControlsEnabled(false)
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      return
    }

    // Outside sketch mode, left-drag orbits and a left *click* selects. Which
    // one this turns out to be is only known on release, so just remember where
    // it started. Selecting on press instead - the original behaviour - meant
    // every attempt to orbit also reselected whatever was under the cursor,
    // which is what made the view feel like it was fighting back.
    downRef.current = { x: e.clientX, y: e.clientY }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const engine = engineRef.current
    if (handleDragRef.current) {
      handleDragRef.current = null
      downRef.current = null
      engine?.setControlsEnabled(true)
      return
    }
    const drag = draggingRef.current
    if (drag) {
      draggingRef.current = null
      downRef.current = null
      engine?.setControlsEnabled(true)
      const store = useStore.getState()
      if (drag.moved) {
        // Re-solve without the drag term so the result is exactly constrained.
        store.solveActiveSketch()
        store.endTransient()
      } else {
        // Never moved: that was a click on a corner, so select it.
        const target = { kind: 'point' as const, id: drag.pointId }
        store.setSketchSelection(
          e.shiftKey ? toggleSelection(store.sketchSelection, target) : [target],
        )
      }
      return
    }
    if (!activeSketch) engine?.setControlsEnabled(true)

    const down = downRef.current
    downRef.current = null
    if (activeSketch || !down || !engine || engine.isGizmoDragging()) return

    // A few pixels of slop, so a click with a shaky hand is still a click.
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP_PX) return

    const store = useStore.getState()
    if (useCommand.getState().session) {
      const filter = acceptedKinds()
      if (filter.has('profile')) {
        const profile = engine.pickProfile(e.clientX, e.clientY)
        if (profile && offerPick(profilePick(store.doc, profile.sketchId, profile.key))) return
      }
      if (filter.has('edge') || filter.has('face')) {
        const sub = engine.pickSub(e.clientX, e.clientY)
        const kind = sub?.kind === 'edge' && filter.has('edge') ? 'edge' : 'face'
        const face = kind === 'face' ? engine.pick(e.clientX, e.clientY) : null
        const picked =
          kind === 'edge' && sub
            ? elementPick(
                store.doc,
                { bodyId: sub.bodyId, kind: 'edge', name: sub.name },
                sub.instanceId,
              )
            : face && face.kind === 'body' && filter.has('face')
              ? elementPick(
                  store.doc,
                  { bodyId: face.bodyId, kind: 'face', name: face.faceName },
                  face.instanceId,
                )
              : null
        if (offerPick(picked)) return
      }
      if (filter.has('body')) {
        const hit = engine.pick(e.clientX, e.clientY)
        if (hit?.kind === 'body') offerPick(bodyPick(store.doc, hit.bodyId, hit.instanceId))
      }
      return
    }
    const hit = engine.pick(e.clientX, e.clientY)

    if (store.tool === 'measure') {
      if (hit) store.addMeasurePoint(hit.point)
      else store.setStatus('Click on a part, not empty space.')
      return
    }

    if (!hit) {
      if (!e.shiftKey) {
        store.select({ kind: 'none' })
        store.setSubSelection([])
      }
      return
    }

    if (hit.kind === 'catalogue') {
      store.select({
        kind: 'occurrence',
        id: hit.path[hit.path.length - 1],
        instanceId: hit.instanceId,
      })
      store.setSubSelection([])
      return
    }

    store.select({ kind: 'body', id: hit.bodyId, instanceId: hit.instanceId })

    const sub = engine.pickSub(e.clientX, e.clientY)
    if (!sub) {
      store.setSubSelection([])
      return
    }
    const current = store.subSelection
    const at = current.findIndex((s) => s.instanceId === sub.instanceId && s.id === sub.id)
    store.setSubSelection(
      e.shiftKey ? (at >= 0 ? current.filter((_, i) => i !== at) : [...current, sub]) : [sub],
    )
  }

  /** Dimension tool: click an entity, type a number. */
  function openDimensionFor(cursor: Vec2, screenX: number, screenY: number) {
    const store = useStore.getState()
    const sketch = activeSketchFeature(store)?.sketch
    if (!sketch) return
    const tolerance = toleranceAt()
    const pts = new Map(sketch.points.map((p) => [p.id, [p.x, p.y] as Vec2]))

    for (const entity of sketch.entities) {
      if (entity.kind === 'line') {
        const a = pts.get(entity.p1)!
        const b = pts.get(entity.p2)!
        const mid = v2.mid(a, b)
        if (v2.dist(cursor, mid) > Math.max(tolerance * 3, v2.dist(a, b) / 2)) continue
        const ab = v2.sub(b, a)
        const len2 = v2.dot(ab, ab)
        const t = Math.max(0, Math.min(1, v2.dot(v2.sub(cursor, a), ab) / len2))
        const on: Vec2 = [a[0] + ab[0] * t, a[1] + ab[1] * t]
        if (v2.dist(cursor, on) > tolerance * 2) continue
        setPrompt({
          x: screenX,
          y: screenY,
          value: fmt(v2.dist(a, b)),
          unit: 'mm',
          apply: (value) => {
            store.addConstraint({ kind: 'distance', a: entity.p1, b: entity.p2, value })
          },
        })
        return
      }
      if (entity.kind === 'circle') {
        const c = pts.get(entity.c)!
        if (Math.abs(v2.dist(cursor, c) - entity.r) > tolerance * 2) continue
        setPrompt({
          x: screenX,
          y: screenY,
          value: fmt(entity.r * 2),
          unit: 'mm',
          apply: (value) => {
            store.addConstraint({ kind: 'diameter', e: entity.id, value })
          },
        })
        return
      }
    }
  }

  // --- keyboard ------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.repeat ||
        (e.target instanceof Element && e.target.closest('dialog'))
      )
        return
      // Never take a key off a field somebody is typing in. Ctrl+C in a text
      // box has to copy text, and Delete has to delete a character.
      const target = e.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }
      const store = useStore.getState()
      const mod = e.ctrlKey || e.metaKey
      const hud = headsUpRef.current
      const actions = toolActionsRef.current
      if (store.activeSketch && isSketchTool(store.tool) && actions && !mod && !e.altKey) {
        if (hud.fields.length && hud.focus) {
          const typing = hud.text.length > 0
          if (/^[0-9.,+\-*/()]$/.test(e.key) || (typing && /^[a-zA-Z ]$/.test(e.key))) {
            e.preventDefault()
            actions.type(hud.text + e.key)
            return
          }
          if (e.key === 'Backspace' && typing) {
            e.preventDefault()
            actions.type(hud.text.slice(0, -1))
            return
          }
          if (e.key === 'Tab') {
            e.preventDefault()
            if (actions.lock()) {
              actions.refresh()
              actions.focusNext()
            }
            return
          }
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          if (hud.text && !actions.lock()) return
          if (!hud.text && actions.finish()) return
          actions.place()
          return
        }
        if (e.key === 'Escape' && hud.text) {
          actions.type('')
          return
        }
      }
      if (e.key === 'Escape') {
        if (toolRef.current.anchors.length) {
          toolActionsRef.current?.reset()
          forceRender((n) => n + 1)
        } else if (store.tool !== 'select') {
          store.setTool('select')
        } else if (store.activeSketch) {
          store.setSketchSelection([])
        } else {
          store.select({ kind: 'none' })
          store.setSubSelection([])
        }
      }
      const key = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.key.toLowerCase()

      if (mod && key === 'z') {
        e.preventDefault()
        e.shiftKey ? store.redo() : store.undo()
        return
      }
      if (mod && key === 'y') {
        e.preventDefault()
        store.redo()
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (store.activeSketch) {
          if (store.sketchSelection.length) {
            e.preventDefault()
            deleteSketchSelection()
          }
          return
        }
        if (store.selection.kind === 'body' && store.selection.id) {
          e.preventDefault()
          store.removeBody(store.selection.id)
          store.select({ kind: 'none' })
        } else if (store.selection.kind === 'occurrence' && store.selection.id) {
          e.preventDefault()
          store.removeOccurrence(store.selection.id)
          store.select({ kind: 'none' })
        }
        return
      }

      if (mod && (key === 'c' || key === 'x') && !store.activeSketch) {
        if (copySelection(key === 'x')) e.preventDefault()
        return
      }
      if (mod && key === 'v' && !store.activeSketch) {
        if (pasteClipboard()) e.preventDefault()
        return
      }
      // Duplicate is copy and paste in one press, which is what people reach
      // for when the thing they want another of is already selected.
      if (mod && key === 'd' && !store.activeSketch) {
        e.preventDefault()
        if (copySelection(false)) pasteClipboard()
        return
      }

      if (mod && key === 's') {
        e.preventDefault()
        void saveDocument(store.doc)
        return
      }

      if (!mod && !e.altKey && e.key === 'Home') {
        window.dispatchEvent(new CustomEvent('okc:fit'))
        return
      }

      // Modelling shortcuts are resolved centrally by the workspace toolbar.
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="viewport">
      <CommandHost />
      <div
        ref={mountRef}
        className="viewport-canvas"
        onPointerDownCapture={(e) => {
          if (!isAndroidApp) return
          if (e.pointerType === 'pen') penContactRef.current = true
          if (e.pointerType === 'touch' && penContactRef.current) {
            e.preventDefault()
            e.stopPropagation()
          }
        }}
        onPointerMoveCapture={(e) => {
          if (isAndroidApp && e.pointerType === 'touch' && penContactRef.current) {
            e.preventDefault()
            e.stopPropagation()
          }
        }}
        onPointerUpCapture={(e) => {
          if (e.pointerType === 'pen') penContactRef.current = false
        }}
        onPointerMove={(e) => {
          if (isAndroidApp && e.pointerType === 'touch') return
          // Any real movement means a drag, not a press-and-hold.
          if (
            holdRef.current !== null &&
            downRef.current &&
            Math.hypot(e.clientX - downRef.current.x, e.clientY - downRef.current.y) > HOLD_SLOP_PX
          ) {
            cancelHold()
          }
          onPointerMove(e)
        }}
        onPointerDown={(e) => {
          // Finger gestures only navigate; they never create points or drag sketch geometry.
          // OrbitControls receives these events directly on its canvas.
          if (isAndroidApp && e.pointerType === 'touch') return
          // A mouse already has a right button. The S Pen has a barrel button
          // and raises contextmenu itself, so this is for finger and for a pen
          // held down without it.
          if (
            (e.pointerType === 'touch' || e.pointerType === 'pen') &&
            (!activeSketch || tool === 'select')
          ) {
            const { clientX, clientY } = e
            const target = e.currentTarget
            cancelHold()
            holdRef.current = window.setTimeout(() => {
              holdRef.current = null
              // Tell the user it landed. A menu appearing with no other signal
              // reads as a misfire on a touchscreen.
              if (navigator.vibrate) navigator.vibrate(12)
              target.dispatchEvent(
                new MouseEvent('contextmenu', { bubbles: true, clientX, clientY }),
              )
            }, HOLD_MS)
          }
          onPointerDown(e)
        }}
        onPointerUp={(e) => {
          if (isAndroidApp && e.pointerType === 'touch') return
          cancelHold()
          onPointerUp(e)
        }}
        onPointerCancel={() => {
          penContactRef.current = false
          cancelHold()
          if (draggingRef.current?.moved) useStore.getState().endTransient()
          draggingRef.current = null
          engineRef.current?.setControlsEnabled(true)
        }}
        onPointerLeave={cancelHold}
        onContextMenu={(e) => {
          e.preventDefault()
          if (!activeSketch) {
            const engine = engineRef.current
            if (!engine) return
            const hit = engine.pick(e.clientX, e.clientY)
            const store = useStore.getState()
            store.select(
              !hit
                ? { kind: 'none' }
                : hit.kind === 'catalogue'
                  ? {
                      kind: 'occurrence',
                      id: hit.path[hit.path.length - 1],
                      instanceId: hit.instanceId,
                    }
                  : { kind: 'body', id: hit.bodyId, instanceId: hit.instanceId },
            )
            setObjectMenu({
              x: e.clientX,
              y: e.clientY,
              picked:
                hit && hit.kind === 'body'
                  ? {
                      bodyId: hit.bodyId,
                      instanceId: hit.instanceId,
                      name: hit.faceName,
                      point: hit.localPoint,
                      normal: hit.localNormal,
                    }
                  : null,
            })
            return
          }
          // Mid-drawing, right-click means "stop this chain" - that has to keep
          // working, or the line tool becomes a trap.
          if (toolRef.current.anchors.length) {
            if (!toolActionsRef.current?.finish()) toolActionsRef.current?.reset()
            forceRender((n) => n + 1)
            return
          }
          const store = useStore.getState()
          const sketch = activeSketchFeature(store)?.sketch
          const cursor = pointerToSketch(e)
          if (!sketch || !cursor) return
          // Right-click on nothing selected picks whatever is under the cursor,
          // so the common case needs no left-click first. But once something is
          // selected, right-clicking anywhere just opens the menu for it and
          // never changes it - otherwise right-clicking near the origin quietly
          // adds a third item and every option disappears.
          if (store.sketchSelection.length === 0) {
            const hit = hitTestSketch(sketch, cursor, toleranceAt())
            if (hit) store.setSketchSelection([hit])
          }
          setMenu({ x: e.clientX, y: e.clientY, cursor })
        }}
      />

      {handleScreens.map((screen) => {
        const handle = activeHandles.find((candidate) => candidate.id === screen.id)
        const field = handle ? commandSession?.state.fields[handle.input] : undefined
        if (!handle || !field || !('text' in field)) return null
        return (
          <input
            key={screen.id}
            className="okc-handle-value"
            style={{ left: screen.x + 18, top: screen.y - 34 }}
            value={field.text}
            spellCheck={false}
            aria-label={handle.input}
            onFocus={(e) => e.currentTarget.select()}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) =>
              useCommand
                .getState()
                .dispatch({ type: 'text', id: handle.input, text: e.target.value })
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
            }}
          />
        )
      })}
      {labels
        .filter((label) =>
          label.kind === 'dimension'
            ? preferences.sketchShowDimensions
            : label.kind === 'constraint'
              ? preferences.sketchShowConstraints
              : true,
        )
        .map((label) => (
          <div
            key={label.id}
            className={`vp-label vp-label-${label.kind}${
              sketchSelection.some((t) => t.kind === 'constraint' && t.id === label.id)
                ? ' selected'
                : ''
            }`}
            style={{ left: label.x, top: label.y }}
            title={
              label.kind === 'constraint'
                ? `${constraintTitle(label.id)} - click to select, Delete to remove`
                : 'Click to change this size'
            }
            onPointerDown={(e) => {
              if (!activeSketch) return
              e.stopPropagation()
              if (label.kind === 'constraint') {
                const store = useStore.getState()
                const target = { kind: 'constraint' as const, id: label.id }
                store.setSketchSelection(
                  e.shiftKey ? toggleSelection(store.sketchSelection, target) : [target],
                )
              } else {
                const constraint = activeSketchFeature(
                  useStore.getState(),
                )?.sketch.constraints.find((c) => c.id === label.id)
                if (!constraint || !('value' in constraint)) return
                setPrompt({
                  x: e.clientX,
                  y: e.clientY,
                  value: String(constraint.value),
                  unit: constraint.kind === 'angle' ? '°' : 'mm',
                  apply: (value) => {
                    const store = useStore.getState()
                    store.editSketch((sketch) => {
                      const c = sketch.constraints.find((x) => x.id === label.id)
                      if (c && 'value' in c) c.value = value
                    })
                    store.solveActiveSketch()
                  },
                })
              }
            }}
          >
            {label.text}
          </div>
        ))}

      {activeSketch &&
        headsUp.fields.map((field) => (
          <div
            key={field.id}
            className={`vp-headsup${field.id === headsUp.focus ? ' focus' : ''}${field.locked ? ' locked' : ''}`}
            style={{ left: field.x, top: field.y }}
            title={`${field.label}: type a value, Tab for the next box, Enter to place`}
          >
            <span className="vp-headsup-label">{field.label}</span>
            <span className="vp-headsup-value">
              {field.id === headsUp.focus && headsUp.text
                ? headsUp.text
                : headsUpValue(field, doc.units)}
            </span>
          </div>
        ))}

      {cursorHint && (
        <div className="vp-snap-hint" style={{ left: cursorHint.x + 14, top: cursorHint.y + 14 }}>
          {cursorHint.text}
        </div>
      )}

      {menu && activeSketch && (
        <SketchMenu x={menu.x} y={menu.y} cursor={menu.cursor} onClose={() => setMenu(null)} />
      )}

      {objectMenu && !activeSketch && (
        <ObjectMenu
          x={objectMenu.x}
          y={objectMenu.y}
          actions={objectActions(selection, objectMenu.picked)}
          onClose={() => setObjectMenu(null)}
        />
      )}

      <ViewCube />
    </div>
  )
}

const MODIFY_HINTS: Record<string, string> = {
  trim: 'Trim: click the piece to remove · Esc to finish',
  extend: 'Extend: click near the end to lengthen · Esc to finish',
  break: 'Break: click the piece to split off · Esc to finish',
  mirror: 'Mirror: click the line to mirror about',
}

interface HeadsUp {
  fields: Array<ToolField & { x: number; y: number }>
  focus: string | null
  text: string
}

interface ToolActions {
  reset: () => void
  refresh: () => void
  place: () => void
  finish: () => boolean
  lock: () => boolean
  focusNext: () => void
  type: (text: string) => void
}

function freeToolAnchor(point: Vec2): ToolAnchor {
  return { point, snapToPointId: null, onEntityId: null, onEntityKind: null, align: null }
}

function headsUpValue(field: ToolField, unit: LengthUnit): string {
  if (field.kind === 'count') return String(Math.round(field.value))
  if (field.kind === 'angle') return `${field.value.toFixed(1)}°`
  return lengthLabel(field.value, unit)
}

function constraintTitle(id: string): string {
  const sketch = activeSketchFeature(useStore.getState())?.sketch
  const constraint = sketch?.constraints.find((c) => c.id === id)
  return constraint ? CONSTRAINT_LABELS[constraint.kind] : 'Constraint'
}

/** Split a sketch selection into the shape the engine wants for highlighting. */
function selectionHighlight(selection: { kind: string; id: string }[]): {
  points: string[]
  entities: string[]
} {
  return {
    points: selection.filter((s) => s.kind === 'point').map((s) => s.id),
    entities: selection.filter((s) => s.kind === 'entity').map((s) => s.id),
  }
}

/**
 * Which geometry the solver still lets move. An edge counts as loose if either
 * of its ends does, which is what makes a half-pinned rectangle read correctly:
 * the two edges touching the anchored corner stay white, the rest go blue.
 */
function looseGeometry(
  sketch: Sketch2D,
  status: { freePoints: string[]; freeEntities: string[] } | null,
): { points: string[]; entities: string[] } {
  if (!status) return { points: [], entities: [] }
  const free = new Set(status.freeEntities)
  return {
    points: status.freePoints,
    entities: sketch.entities.filter((e) => free.has(e.id)).map((e) => e.id),
  }
}

/** Short symbols for the constraints that carry no number. */
const GLYPH: Partial<Record<Constraint['kind'], string>> = {
  horizontal: '—',
  vertical: '|',
  parallel: '∥',
  perpendicular: '⊥',
  equal: '=',
  tangent: '⌒',
  tangentArcs: '⌒',
  tangentCurves: '⌒',
  coincident: '◦',
  fix: '🔒',
  pointOnLine: '◦',
  pointOnCircle: '◦',
  pointOnCurve: '◦',
  midpoint: '△',
  symmetric: '⋈',
  symmetricEntities: '⋈',
  collinear: '⋯',
  concentric: '◎',
  smooth: '∿',
}

function sketchLabels(sketch: Sketch2D, frame: Frame, unit: LengthUnit) {
  const pts = new Map(sketch.points.map((p) => [p.id, [p.x, p.y] as Vec2]))
  const out: Array<{
    id: string
    text: string
    at: [number, number, number]
    kind: 'dimension' | 'constraint'
  }> = []
  const length = (mm: number) => lengthLabel(mm, unit, false)

  const entityAnchor = (entityId: string): Vec2 | null => {
    const entity = sketch.entities.find((e) => e.id === entityId)
    if (!entity) return null
    if (entity.kind === 'line') {
      const a = pts.get(entity.p1)
      const b = pts.get(entity.p2)
      return a && b ? v2.mid(a, b) : null
    }
    const centre = entityCentre(entity)
    if (centre) return pts.get(centre) ?? null
    const polyline = tessellate(entity, pts, 0.1)
    return polyline[Math.floor(polyline.length / 2)] ?? null
  }

  // Spread glyphs that land on the same spot so they do not stack up.
  const used = new Map<string, number>()
  const nudge = (p: Vec2): Vec2 => {
    const key = `${Math.round(p[0])},${Math.round(p[1])}`
    const n = used.get(key) ?? 0
    used.set(key, n + 1)
    return [p[0], p[1] - n * 4]
  }

  for (const c of sketch.constraints) {
    if (c.kind === 'distance' || c.kind === 'distanceX' || c.kind === 'distanceY') {
      const a = pts.get(c.a)
      const b = pts.get(c.b)
      if (!a || !b) continue
      out.push({
        id: c.id,
        text: length(c.value),
        at: frameToWorld(frame, v2.mid(a, b)),
        kind: 'dimension',
      })
      continue
    }
    if (c.kind === 'radius' || c.kind === 'diameter') {
      const anchor = entityAnchor(c.e)
      if (!anchor) continue
      out.push({
        id: c.id,
        text: c.kind === 'radius' ? `R${length(c.value)}` : `⌀${length(c.value)}`,
        at: frameToWorld(frame, anchor),
        kind: 'dimension',
      })
      continue
    }
    if (c.kind === 'angle') {
      const anchor = entityAnchor(c.a)
      if (!anchor) continue
      out.push({
        id: c.id,
        text: `${fmt(c.value)}°`,
        at: frameToWorld(frame, anchor),
        kind: 'dimension',
      })
      continue
    }

    const glyph = GLYPH[c.kind]
    if (!glyph) continue
    // The origin's own pin is noise: it is there in every sketch and can never
    // be removed, so drawing it just trains people to ignore glyphs.
    if (c.kind === 'fix' && c.p === 'origin') continue

    let anchor: Vec2 | null = null
    if ('e' in c && typeof c.e === 'string') anchor = entityAnchor(c.e)
    else if ('line' in c) anchor = entityAnchor(c.line)
    else if ('a' in c && typeof c.a === 'string') {
      anchor = pts.get(c.a) ?? entityAnchor(c.a)
    } else if ('p' in c) anchor = pts.get(c.p) ?? null
    if (!anchor) continue

    out.push({
      id: c.id,
      text: glyph,
      at: frameToWorld(frame, nudge(anchor)),
      kind: 'constraint',
    })
  }
  return out
}

function ViewCube() {
  return (
    <div className="view-cube">
      {(['top', 'front', 'right', 'iso'] as const).map((view) => (
        <button
          key={view}
          title={view === 'iso' ? 'Three-quarter view' : `Look straight at the ${view}`}
          onClick={() => window.dispatchEvent(new CustomEvent('okc:view', { detail: view }))}
        >
          {view === 'iso' ? '3D' : view[0].toUpperCase() + view.slice(1)}
        </button>
      ))}
    </div>
  )
}
