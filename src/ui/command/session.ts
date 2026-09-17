import { create } from 'zustand'
import { userParts } from '../../catalogue'
import { featureIndex, findFeature, markerIndex } from '../../doc/model'
import { parameterValues } from '../../doc/parameters'
import {
  activeComponentOf,
  addCreatedBodies,
  insertFeatures,
  newId,
  replaceFeatureInDocument,
  useStore,
} from '../../doc/store'
import type { Feature, OkcDocument } from '../../doc/types'
import { cancelPreview, requestPreview } from '../../kernel/api'
import type { BodyMesh, Instance, KernelError } from '../../kernel/types'
import { createCommandState, reduceCommand, type CommandAction, type CommandState } from './state'
import type {
  AnyCommandSpec,
  CommandContext,
  CommandInitialValues,
  LooseCommandValues,
} from './types'

export interface CommandSession {
  spec: AnyCommandSpec
  state: CommandState
  context: CommandContext
  links: Readonly<Record<string, string>>
  serial: number
}

export interface CommandPreviewScene {
  instances: Instance[]
  meshes: ReadonlyMap<string, BodyMesh>
  errors: KernelError[]
}

export interface CommandStart {
  editing?: Feature
  initial?: CommandInitialValues
  ids?: Record<string, string>
}

interface CommandStore {
  session: CommandSession | null
  preview: CommandPreviewScene | null
  start: (spec: AnyCommandSpec, options?: CommandStart) => void
  dispatch: (action: CommandAction) => void
  show: (features: Feature[] | null, values?: LooseCommandValues) => void
  commit: (features: Feature[], values?: LooseCommandValues) => void
  cancel: () => void
}

let ticket = 0
let serial = 0

function parameterResolver(doc: OkcDocument): ((name: string) => number) | undefined {
  if (!doc.parameters.length) return undefined
  let values: Map<string, number>
  try {
    values = parameterValues(doc.parameters)
  } catch {
    return undefined
  }
  return (name) => {
    const value = values.get(name)
    if (value === undefined) throw new Error(`There is no parameter called ${name}.`)
    return value
  }
}

function linkedFields(spec: AnyCommandSpec, doc: OkcDocument, editing?: Feature) {
  const links: Record<string, string> = {}
  if (!editing) return links
  for (const input of spec.inputs) {
    if ((input.kind !== 'length' && input.kind !== 'angle') || !input.field) continue
    const link = doc.bindings.find(
      (binding) => binding.featureId === editing.id && binding.field === input.field,
    )
    if (link) links[input.id] = link.expression
  }
  return links
}

export const useCommand = create<CommandStore>((set, get) => ({
  session: null,
  preview: null,

  start(spec, options = {}) {
    const store = useStore.getState()
    const doc = store.doc
    const ids: Record<string, string> = { ...options.ids }
    const editing = options.editing
    const context: CommandContext = {
      doc,
      unit: doc.units,
      componentId: editing?.componentId ?? activeComponentOf(store),
      id: (role) => (ids[role] ??= newId(role)),
      variable: parameterResolver(doc),
      editing,
      editingFeatureId: editing?.id,
    }
    const links = linkedFields(spec, doc, editing)
    ticket++
    cancelPreview()
    set({
      session: {
        spec,
        state: createCommandState(spec, context, { ...options.initial, ...links }),
        context,
        links,
        serial: ++serial,
      },
      preview: null,
    })
  },

  dispatch(action) {
    const session = get().session
    if (!session) return
    const state = reduceCommand(session.spec, session.state, action, session.context)
    if (state !== session.state) set({ session: { ...session, state } })
  },

  show(features, values = {}) {
    const session = get().session
    const current = ++ticket
    if (!session || !features) {
      cancelPreview()
      set({ preview: null })
      return
    }
    const doc = structuredClone(useStore.getState().doc)
    addCreatedBodies(doc, features)
    if (session.spec.adjust) {
      const trial = structuredClone(doc)
      const editingId = session.context.editingFeatureId
      if (editingId) replaceFeatureInDocument(trial, editingId, features)
      else insertFeatures(trial, features)
      try {
        session.spec.adjust(trial, features, session.context, values as never)
        doc.occurrences = trial.occurrences
      } catch {
        return
      }
    }
    const editing = session.context.editingFeatureId
    const at = editing ? featureIndex(doc, editing) : -1
    requestPreview(
      {
        doc: { ...doc, customParts: userParts() },
        features,
        insertAt: at >= 0 ? at : markerIndex(doc),
        replaceFeatureId: editing,
      },
      () => [...useStore.getState().meshes.keys(), ...(get().preview?.meshes.keys() ?? [])],
    ).then((result) => {
      if (current !== ticket || !get().session) return
      const crashed = !result.instances.length && result.errors.some((e) => e.featureId === '')
      const previous = get().preview
      if (crashed && previous) {
        set({ preview: { ...previous, errors: result.errors } })
        return
      }
      const meshes = new Map(previous?.meshes ?? [])
      for (const mesh of result.meshes) meshes.set(mesh.key, mesh)
      const used = new Set(result.instances.map((instance) => instance.meshKey))
      for (const key of [...meshes.keys()]) if (!used.has(key)) meshes.delete(key)
      set({ preview: { instances: result.instances, meshes, errors: result.errors } })
    })
  },

  commit(features, values = {}) {
    const session = get().session
    if (!session) return
    ticket++
    cancelPreview()
    set({ session: null, preview: null })
    const editing = session.context.editingFeatureId
    const kept = new Set(
      session.spec.inputs.flatMap((input) => {
        if ((input.kind !== 'length' && input.kind !== 'angle') || !input.field) return []
        const field = session.state.fields[input.id]
        const link = session.links[input.id]
        return link !== undefined && field && 'text' in field && field.text === link
          ? [input.field]
          : []
      }),
    )
    useStore.getState().commit((doc) => {
      const adjust = () => {
        try {
          session.spec.adjust?.(doc, features, session.context, values as never)
        } catch {
          return
        }
      }
      if (!editing) {
        insertFeatures(doc, features)
        adjust()
        for (const feature of features) {
          if (
            feature.kind !== 'extrude' &&
            feature.kind !== 'revolve' &&
            feature.kind !== 'emboss'
          ) {
            continue
          }
          const sketch = findFeature(doc, feature.sketchId)
          if (sketch?.kind === 'sketch') sketch.visible = false
        }
        return
      }
      replaceFeatureInDocument(doc, editing, features)
      doc.bindings = doc.bindings.filter(
        (link) => link.featureId !== editing || kept.has(link.field),
      )
      adjust()
    })
  },

  cancel() {
    ticket++
    cancelPreview()
    set({ session: null, preview: null })
  },
}))
