import * as Comlink from 'comlink'
import { allParts, getPart, partBounds, userParts } from '../catalogue'
import { partFootprint } from '../catalogue/types'
import { bootOnce } from '../doc/boot'
import { getMeshData, meshDataIds } from '../doc/meshData'
import { allBodies, featureCreatesBodies, findFeature, identityMatrix } from '../doc/model'
import { resolveParameters } from '../doc/parameters'
import {
  activeComponentOf,
  instanceWorldBounds,
  newId,
  occurrenceName,
  useStore,
} from '../doc/store'
import type { Component, Feature, OkcDocument } from '../doc/types'
import type { BodyMesh, EvaluateResult, Instance, KernelApi } from '../kernel/types'
import { kernel } from '../kernel/api'
import { COMMANDS, editOptions } from '../ui/command/commands'
import {
  bodyPick,
  elementPick,
  featurePick,
  occurrencePick,
  planePick,
  sketchPick,
} from '../ui/command/picks'
import { applyBuiltCommand, parameterResolver } from '../ui/command/session'
import { createCommandState, evaluateCommand } from '../ui/command/state'
import type {
  AnyCommandSpec,
  CommandContext,
  CommandInitialValues,
  CommandValue,
  ListValue,
  SelectionPick,
} from '../ui/command/types'
import { renderSnapshot } from './snapshot'
import { faceSummaries } from './geometry'

type ObjectValue = Record<string, unknown>
type Alias = { features: string[]; bodies: string[]; occurrence?: string }
type Operation = {
  command?: string
  args?: ObjectValue
  edit?: string
  partId?: string
  at?: number[]
  as?: string
}
type Plan = {
  catalogueKey: string
  revision: number
  doc: OkcDocument
  aliases: Record<string, Alias>
  scene: EvaluateResult
  expires: number
}

const supported = new Set([
  'box',
  'cylinder',
  'sphere',
  'torus',
  'extrude',
  'revolve',
  'fillet',
  'chamfer',
  'hollow',
  'combine',
  'move',
  'scale',
  'mirror',
  'bodyPattern',
  'splitBody',
  'hole',
  'enclosure',
  'boardClips',
  'fitCoupon',
  'offsetPlane',
  'midplane',
  'planeAtAngle',
  'loft',
  'sweep',
  'coil',
  'draft',
  'offsetFace',
  'pressPull',
  'rib',
  'web',
  'emboss',
])

class AgentError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

function object(value: unknown, label: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AgentError('INVALID_INPUT', `${label} must be an object.`)
  return value as ObjectValue
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.length)
    throw new AgentError('INVALID_INPUT', `${label} must be a non-empty string.`)
  return value
}

function exact<T extends { id: string; name?: string }>(items: T[], query: ObjectValue): T {
  const matches = items.filter((item) =>
    query.id !== undefined ? item.id === query.id : item.name === query.name,
  )
  if (matches.length !== 1)
    throw new AgentError(
      matches.length ? 'AMBIGUOUS_REFERENCE' : 'REFERENCE_NOT_FOUND',
      'Use an exact ID from inspect().',
      { candidates: matches.map(({ id, name }) => ({ id, name })) },
    )
  return matches[0]
}

function selection(doc: OkcDocument, raw: unknown, aliases: Record<string, Alias>): SelectionPick {
  const ref = object(raw, 'Selection reference')
  const kind = text(ref.kind, 'Reference kind')
  if (typeof ref.id === 'string' && ref.id.startsWith('@')) {
    const alias = aliases[ref.id.slice(1)]
    if (!alias) throw new AgentError('REFERENCE_NOT_FOUND', `Unknown alias ${ref.id}.`)
    const ids =
      kind === 'body'
        ? alias.bodies
        : kind === 'occurrence'
          ? [alias.occurrence].filter(Boolean)
          : alias.features
    if (ids.length !== 1)
      throw new AgentError(
        'AMBIGUOUS_REFERENCE',
        `Alias ${ref.id} has ${ids.length} ${kind} results.`,
        alias,
      )
    return selection(doc, { ...ref, id: ids[0] }, aliases)
  }
  let pick: SelectionPick | null = null
  if (kind === 'plane') {
    if (!['XY', 'XZ', 'YZ'].includes(String(ref.name)))
      throw new AgentError('INVALID_INPUT', 'Named plane must be XY, XZ or YZ.')
    const offset = ref.offset ?? 0
    if (typeof offset !== 'number' || !Number.isFinite(offset))
      throw new AgentError('INVALID_INPUT', 'Plane offset must be finite millimetres.')
    pick = planePick(doc, { kind: 'named', name: ref.name as 'XY' | 'XZ' | 'YZ', offset })
  } else if (kind === 'body')
    pick = bodyPick(
      doc,
      exact(
        allBodies(doc).map(({ body }) => body),
        ref,
      ).id,
    )
  else if (kind === 'occurrence') pick = occurrencePick(doc, exact(doc.occurrences, ref).id)
  else if (kind === 'feature' || kind === 'sketch') {
    const feature = exact(doc.timeline, ref)
    pick = kind === 'sketch' ? sketchPick(doc, feature.id) : featurePick(doc, feature.id)
  } else if (kind === 'face' || kind === 'edge') {
    const bodyId = text(ref.bodyId, 'bodyId')
    const name = text(ref.name, 'Element name')
    const meshes = [...useStore.getState().meshes.values()].filter((mesh) => mesh.bodyId === bodyId)
    const found = meshes.some((mesh) =>
      (kind === 'face' ? mesh.mesh.faceGroups : mesh.edges.edgeGroups).some(
        (group) => group.name === name,
      ),
    )
    if (!found)
      throw new AgentError(
        'REFERENCE_NOT_FOUND',
        'Get a current named face or edge from geometry(bodyId).',
      )
    pick = elementPick(
      doc,
      { bodyId, kind, name },
      typeof ref.instanceId === 'string' ? ref.instanceId : undefined,
    )
  }
  if (!pick)
    throw new AgentError('REFERENCE_NOT_FOUND', `Unsupported or missing ${kind} reference.`)
  return pick
}

function initialValues(
  spec: AnyCommandSpec,
  args: ObjectValue,
  doc: OkcDocument,
  aliases: Record<string, Alias>,
): CommandInitialValues {
  const result: Record<string, CommandValue | undefined> = {}
  for (const [key, value] of Object.entries(args)) {
    const input = spec.inputs.find((input) => input.id === key)
    if (!input) throw new AgentError('INVALID_INPUT', `Unknown ${spec.id} argument: ${key}.`)
    if (input.kind === 'selection') {
      if (
        !Array.isArray(value) ||
        value.length < input.min ||
        (input.max !== undefined && value.length > input.max)
      )
        throw new AgentError(
          'INVALID_INPUT',
          `${key} must be an array with ${input.min}–${input.max ?? 'any'} references.`,
        )
      result[key] = value.map((raw) => selection(doc, raw, aliases))
      if ((result[key] as SelectionPick[]).some((pick) => !input.filter.includes(pick.kind)))
        throw new AgentError('INVALID_INPUT', `${key} accepts ${input.filter.join(', ')}.`)
    } else if (input.kind === 'toggle') {
      if (typeof value !== 'boolean')
        throw new AgentError('INVALID_INPUT', `${key} must be boolean.`)
      result[key] = value
    } else if (input.kind === 'choice') {
      if (!input.options.some((option) => option.value === value))
        throw new AgentError('INVALID_INPUT', `Invalid ${key} choice.`, input.options)
      result[key] = value as string
    } else if (input.kind === 'list') {
      const rows = object(value, key)
      if (Object.values(rows).some((value) => typeof value !== 'string'))
        throw new AgentError('INVALID_INPUT', `${key} values must be strings.`)
      result[key] = rows as ListValue
    } else {
      if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value)))
        throw new AgentError('INVALID_INPUT', `${key} must be a finite number or expression.`)
      result[key] =
        typeof value === 'number'
          ? `${value}${input.kind === 'length' ? ' mm' : input.kind === 'angle' ? ' deg' : ''}`
          : value
    }
  }
  return result
}

function compile(
  doc: OkcDocument,
  operations: Operation[],
  componentId: string,
): Record<string, Alias> {
  const aliases: Record<string, Alias> = Object.create(null)
  for (let index = 0; index < operations.length; index++) {
    try {
      const operation = object(operations[index], 'Operation') as Operation
      for (const key of Object.keys(operation))
        if (!['command', 'args', 'edit', 'partId', 'at', 'as'].includes(key))
          throw new AgentError('INVALID_INPUT', `Unknown operation field: ${key}.`)
      if (
        operation.as !== undefined &&
        (!/^[a-zA-Z][\w-]*$/.test(text(operation.as, 'as')) || aliases[operation.as])
      )
        throw new AgentError('INVALID_INPUT', 'Alias must be unique and start with a letter.')
      let output: Alias
      if (operation.partId !== undefined) {
        if (operation.command || operation.edit || operation.args)
          throw new AgentError('INVALID_INPUT', 'Insert a part in a separate operation.')
        const part = getPart(text(operation.partId, 'partId'))
        if (!part)
          throw new AgentError('REFERENCE_NOT_FOUND', 'Unknown catalogue part. Use catalogue().')
        const at = operation.at ?? [0, 0, 0]
        if (
          !Array.isArray(at) ||
          at.length !== 3 ||
          at.some((n) => typeof n !== 'number' || !Number.isFinite(n))
        )
          throw new AgentError(
            'INVALID_INPUT',
            'at must contain three finite millimetre coordinates.',
          )
        const component: Component = {
          id: newId('part'),
          name: part.name,
          source: { kind: 'catalogue', partId: part.id },
          bodies: [],
        }
        const matrix = identityMatrix()
        matrix[12] = at[0]
        matrix[13] = at[1]
        matrix[14] = at[2]
        const id = newId('occ')
        doc.components.push(component)
        doc.occurrences.push({
          id,
          parentComponentId: componentId,
          componentId: component.id,
          name: occurrenceName(doc, component),
          transform: matrix,
          visible: true,
          grounded: false,
        })
        output = { features: [], bodies: [], occurrence: id }
      } else {
        if (operation.at !== undefined)
          throw new AgentError('INVALID_INPUT', 'at is only used when inserting a catalogue part.')
        const command = text(operation.command, 'command')
        if (!supported.has(command) || !COMMANDS[command])
          throw new AgentError('UNSUPPORTED_COMMAND', 'Use a command from commands().')
        const spec = COMMANDS[command]
        const args = operation.args === undefined ? {} : object(operation.args, 'args')
        const editing =
          operation.edit !== undefined ? findFeature(doc, text(operation.edit, 'edit')) : undefined
        if (operation.edit !== undefined && !editing)
          throw new AgentError('REFERENCE_NOT_FOUND', 'Unknown feature to edit.')
        const options = editing ? editOptions(doc, editing) : null
        if (editing && (!options || options[0].id !== spec.id))
          throw new AgentError('UNSUPPORTED_COMMAND', 'That command cannot edit this feature.')
        const ids = { ...options?.[1].ids }
        const context: CommandContext = {
          doc,
          unit: doc.units,
          componentId: editing?.componentId ?? componentId,
          editing,
          editingFeatureId: editing?.id,
          id: (role) => (ids[role] ??= newId(role)),
          variable: parameterResolver(doc),
        }
        const kept = new Set<string>()
        const initial: Record<string, CommandValue | undefined> = { ...options?.[1].initial }
        for (const input of spec.inputs) {
          if ((input.kind !== 'length' && input.kind !== 'angle') || !input.field || !editing)
            continue
          const binding = doc.bindings.find(
            (link) => link.featureId === editing.id && link.field === input.field,
          )
          if (binding && !(input.id in args)) {
            initial[input.id] = binding.expression
            kept.add(input.field)
          }
        }
        Object.assign(initial, initialValues(spec, args, doc, aliases))
        for (const input of spec.inputs) {
          const value = initial[input.id]
          if (typeof value === 'number')
            initial[input.id] =
              `${value}${input.kind === 'length' ? ' mm' : input.kind === 'angle' ? ' deg' : ''}`
        }
        const state = createCommandState(spec, context, initial)
        const evaluation = evaluateCommand(spec, state, context, { build: true })
        for (const input of spec.inputs)
          if (input.kind === 'list' && input.id in args) {
            const rows = input.rows(evaluation.values, context)
            for (const [id, value] of Object.entries(args[input.id] as ObjectValue))
              if (
                !rows.some(
                  (row) => row.id === id && row.options.some((option) => option.value === value),
                )
              )
                throw new AgentError(
                  'INVALID_INPUT',
                  `Unknown ${input.id} row or choice: ${id}.`,
                  rows,
                )
          }
        if (!evaluation.valid || evaluation.buildError || !evaluation.features?.length)
          throw new AgentError(
            'COMMAND_INVALID',
            evaluation.formError ?? evaluation.buildError ?? 'Check the command arguments.',
            { fields: evaluation.fieldErrors, missing: evaluation.missing },
          )
        applyBuiltCommand(doc, spec, evaluation.features, context, evaluation.values, kept)
        output = {
          features: evaluation.features.map((feature) => feature.id),
          bodies: evaluation.features.flatMap(featureCreatesBodies),
        }
      }
      if (operation.as) aliases[operation.as] = output
    } catch (error) {
      if (error instanceof AgentError) {
        error.details = { operation: index, cause: error.details }
        throw error
      }
      throw new AgentError('COMMAND_INVALID', String(error), { operation: index })
    }
  }
  resolveParameters(doc, true)
  return aliases
}

async function evaluate(doc: OkcDocument): Promise<EvaluateResult> {
  const worker = new Worker(new URL('../kernel/worker.ts', import.meta.url), { type: 'module' })
  const api = Comlink.wrap<KernelApi>(worker)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const run = async () => {
      await api.ready()
      const meshData = Object.fromEntries(
        meshDataIds(doc)
          .map((id) => [id, getMeshData(id)])
          .filter(([, data]) => data),
      )
      return api.evaluate({ ...doc, customParts: userParts(), meshData } as OkcDocument, [])
    }
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new AgentError('KERNEL_TIMEOUT', 'Preview exceeded 120 seconds.')),
          120000,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
    api[Comlink.releaseProxy]()
    worker.terminate()
  }
}

function sceneSummary(instances: Instance[], meshes: BodyMesh[]) {
  return instances.map((instance) => {
    const mesh = meshes.find((mesh) => mesh.key === instance.meshKey)
    return {
      id: instance.id,
      bodyId: instance.bodyId,
      kind: instance.kind,
      visible: instance.visible,
      bounds: mesh ? instanceWorldBounds({ meshes: new Map([[mesh.key, mesh]]) }, instance) : null,
      volume: mesh?.volume,
    }
  })
}

export function createAgentApi() {
  let revision = 0
  let busy = false
  let disposed = false
  const plans = new Map<string, Plan>()
  const unsubscribe = useStore.subscribe((state, previous) => {
    if (state.doc !== previous.doc) {
      revision++
      plans.clear()
    }
  })
  const guard = () => {
    const state = useStore.getState()
    if (disposed) throw new AgentError('DISCONNECTED', 'Agent API is disconnected.')
    if (
      !state.kernelReady ||
      state.building ||
      state.commandOpen ||
      state.activeSketch ||
      state.transientBase ||
      state.busy
    )
      throw new AgentError('BUSY', 'Wait until the current build, sketch or command is finished.')
  }
  const planOf = (id: unknown) => {
    const plan = plans.get(text(id, 'token'))
    if (
      !plan ||
      plan.revision !== revision ||
      plan.expires < Date.now() ||
      plan.catalogueKey !== JSON.stringify(userParts())
    )
      throw new AgentError(
        'STALE_PREVIEW',
        'The preview expired or the document changed. Inspect and preview again.',
      )
    return plan
  }
  const request = async (raw: unknown) => {
    try {
      if (disposed) throw new AgentError('DISCONNECTED', 'Agent API is disconnected.')
      await bootOnce()
      const input = object(raw, 'Request')
      const method = text(input.method, 'method')
      const args = input.args === undefined ? {} : object(input.args, 'args')
      let data: unknown
      if (method === 'inspect') {
        const state = useStore.getState()
        data = {
          revision,
          name: state.doc.name,
          units: state.doc.units,
          numericUnits: 'mm; angles in degrees',
          ready: state.kernelReady && !state.building,
          activeComponentId: activeComponentOf(state),
          selection: state.selection,
          marker: state.doc.marker,
          parameters: state.doc.parameters,
          bindings: state.doc.bindings,
          components: state.doc.components.map(({ id, name, source, bodies }) => ({
            id,
            name,
            source,
            bodies,
          })),
          occurrences: state.doc.occurrences,
          features: state.doc.timeline.map(({ id, kind, name, suppressed }) => ({
            id,
            kind,
            name,
            suppressed,
          })),
          geometry: sceneSummary(state.instances, [...state.meshes.values()]),
          errors: state.errors,
        }
      } else if (method === 'commands') {
        data = Object.entries(COMMANDS)
          .filter(
            ([id]) => supported.has(id) && (args.command === undefined || args.command === id),
          )
          .map(([id, spec]) => ({
            id,
            label: spec.label,
            hint: spec.hint,
            inputs: spec.inputs.map(({ visible, ...input }) =>
              JSON.parse(
                JSON.stringify({
                  ...input,
                  conditional: !!visible,
                  dynamicRows: input.kind === 'list',
                }),
              ),
            ),
          }))
      } else if (method === 'catalogue') {
        const query = String(args.query ?? '').toLowerCase()
        data = allParts()
          .filter((part) =>
            [part.id, part.name, ...(part.tags ?? [])].join(' ').toLowerCase().includes(query),
          )
          .slice(0, 50)
          .map((part) => {
            const bounds = partBounds(part)
            return {
              id: part.id,
              name: part.name,
              category: part.category,
              size: {
                w: bounds[3] - bounds[0],
                h: bounds[4] - bounds[1],
                z: bounds[5] - bounds[2],
              },
              footprint: partFootprint(part),
              bounds,
              confidence: part.confidence,
            }
          })
      } else if (method === 'part') {
        const part = getPart(text(args.id, 'id'))
        if (!part) throw new AgentError('REFERENCE_NOT_FOUND', 'Unknown catalogue part.')
        data = structuredClone(part)
      } else if (method === 'feature') {
        const feature = exact(useStore.getState().doc.timeline, args)
        data = {
          feature: structuredClone(feature),
          command: editOptions(useStore.getState().doc, feature)?.[0].id,
          values: editOptions(useStore.getState().doc, feature)?.[1].initial,
        }
      } else if (method === 'geometry') {
        guard()
        const bodyId = text(args.bodyId, 'bodyId')
        const meshes = [...useStore.getState().meshes.values()].filter(
          (mesh) => mesh.bodyId === bodyId,
        )
        if (!meshes.length) throw new AgentError('REFERENCE_NOT_FOUND', 'Unknown built body.')
        data = meshes.map((mesh) => ({
          bodyId,
          bounds: mesh.bounds,
          volume: mesh.volume,
          faces: faceSummaries(mesh),
          edges: mesh.edges.edgeGroups.map(({ name, edgeId }) => ({
            kind: 'edge',
            bodyId,
            name,
            edgeId,
          })),
        }))
      } else if (method === 'preview') {
        guard()
        if (busy) throw new AgentError('BUSY', 'Another agent preview is running.')
        if (args.revision !== revision)
          throw new AgentError('REVISION_CONFLICT', 'Inspect the current document first.', {
            revision,
          })
        if (
          !Array.isArray(args.operations) ||
          !args.operations.length ||
          args.operations.length > 100
        )
          throw new AgentError('INVALID_INPUT', 'Provide 1–100 operations.')
        busy = true
        try {
          const base = revision
          const catalogueKey = JSON.stringify(userParts())
          const state = useStore.getState()
          const doc = structuredClone(state.doc)
          const aliases = compile(doc, args.operations as Operation[], activeComponentOf(state))
          const scene = await evaluate(doc)
          guard()
          if (base !== revision || catalogueKey !== JSON.stringify(userParts()))
            throw new AgentError('REVISION_CONFLICT', 'The document changed during preview.', {
              revision,
            })
          const errors = scene.errors.filter((error) => error.severity === 'error')
          if (errors.length)
            throw new AgentError(
              'GEOMETRY_INVALID',
              'The kernel found errors. The document was not changed.',
              { errors: scene.errors },
            )
          const token = newId('preview')
          plans.clear()
          plans.set(token, {
            catalogueKey,
            revision: base,
            doc,
            aliases,
            scene,
            expires: Date.now() + 300000,
          })
          data = {
            token,
            revision: base,
            expiresInSeconds: 300,
            aliases,
            geometry: sceneSummary(scene.instances, scene.meshes),
            errors: scene.errors,
          }
        } finally {
          busy = false
        }
      } else if (method === 'apply') {
        guard()
        const plan = planOf(args.token)
        const aliases = structuredClone(plan.aliases)
        useStore.getState().commit((doc) => Object.assign(doc, structuredClone(plan.doc)))
        data = { revision, aliases }
      } else if (method === 'cancel') {
        plans.delete(text(args.token, 'token'))
        data = { revision }
      } else if (method === 'undo' || method === 'redo') {
        guard()
        if (args.revision !== revision)
          throw new AgentError('REVISION_CONFLICT', 'Inspect before undo or redo.', { revision })
        useStore.getState()[method]()
        data = { revision }
      } else if (method === 'snapshot') {
        guard()
        const plan = args.token ? planOf(args.token) : undefined
        const state = useStore.getState()
        data = renderSnapshot(
          plan?.scene.instances ?? state.instances,
          plan?.scene.meshes ?? [...state.meshes.values()],
          args.view ?? 'iso',
        )
      } else if (method === 'measure') {
        guard()
        const a = text(args.a, 'a')
        const b = text(args.b, 'b')
        const state = useStore.getState()
        if (![a, b].every((id) => state.instances.some((instance) => instance.id === id)))
          throw new AgentError(
            'REFERENCE_NOT_FOUND',
            'Use two instance IDs from inspect().geometry.',
          )
        const base = revision
        const distance = await kernel().distanceBetween(a, b)
        if (base !== revision)
          throw new AgentError('REVISION_CONFLICT', 'The document changed during measurement.')
        if (distance === null)
          throw new AgentError(
            'MEASUREMENT_FAILED',
            'The kernel could not measure these instances.',
          )
        data = { a, b, distance, unit: 'mm' }
      } else
        throw new AgentError(
          'UNKNOWN_METHOD',
          'Use inspect, commands, catalogue, part, feature, geometry, preview, apply, cancel, undo, redo, measure or snapshot.',
        )
      return structuredClone({ ok: true, revision, data })
    } catch (error) {
      const issue =
        error instanceof AgentError
          ? error
          : new AgentError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error))
      return {
        ok: false,
        revision,
        error: { code: issue.code, message: issue.message, details: issue.details },
      }
    }
  }
  return {
    version: 1,
    request,
    dispose: () => {
      disposed = true
      plans.clear()
      unsubscribe()
    },
  }
}

export function installAgentApi() {
  if (new URLSearchParams(location.search).get('agent') !== '1') return
  const api = createAgentApi()
  const target = window as unknown as { openkitcad?: ReturnType<typeof createAgentApi> }
  target.openkitcad = api
  return () => {
    api.dispose()
    if (target.openkitcad === api) delete target.openkitcad
  }
}
