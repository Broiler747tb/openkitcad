import type { Frame } from '../core/math'
import type { Feature, Matrix4, OkcDocument } from '../doc/types'

export interface MeshData {
  vertices: Float32Array
  triangles: Uint32Array
  normals: Float32Array
  faceGroups: Array<{ start: number; count: number; faceId: number; name: string }>
}

export interface EdgeData {
  lines: Float32Array
  edgeGroups: Array<{ start: number; count: number; edgeId: number; name: string }>
}

export interface BodyMesh {
  key: string
  bodyId: string
  componentId: string
  name: string
  colour: string
  mesh: MeshData
  edges: EdgeData
  volume: number
  bounds: [number, number, number, number, number, number]
  kind?: 'solid' | 'surface' | 'mesh'
  pieces?: number
  watertight?: boolean
}

export type InstanceKind = 'body' | 'catalogue'

export interface Instance {
  id: string
  kind: InstanceKind
  path: string[]
  componentId: string
  bodyId: string
  meshKey: string
  matrix: Matrix4
  visible: boolean
  negative: boolean
  preview?: boolean
  previewTool?: 'cut' | 'intersect'
}

export interface KernelError {
  featureId: string
  bodyId?: string
  severity: 'error' | 'warning'
  message: string
  hint?: string
}

export interface CacheStats {
  hits: number
  misses: number
  entries: number
}

export interface ResolvedPlane {
  featureId: string
  frame: Frame
}

export interface EvaluateResult {
  meshes: BodyMesh[]
  instances: Instance[]
  errors: KernelError[]
  elapsedMs: number
  cache: CacheStats
  planes: ResolvedPlane[]
}

export interface PreviewRequest {
  doc: OkcDocument
  features: Feature[]
  insertAt: number
  replaceFeatureId?: string
}

export type ExportFormat = 'step' | 'stl' | 'stl-ascii' | '3mf' | 'obj' | 'dxf' | 'svg' | 'pdf'

export type ProjectionPlane = 'XY' | 'XZ' | 'YZ'

export interface ProjectionResult {
  polylines: Array<Array<[number, number]>>
  circles: Array<{ cx: number; cy: number; r: number }>
  bounds: [number, number, number, number]
}

export interface Clash {
  aLabel: string
  bLabel: string
  overlap: number
  at: [number, number, number]
}

export interface PrintWarning {
  instanceId: string
  name: string
  severity: 'error' | 'warning' | 'info'
  message: string
  hint?: string
  span?: { from: [number, number, number]; to: [number, number, number] }
}

export interface PrintOptions {
  nozzle: number
  bed: [number, number, number]
}

export interface KernelApi {
  ready(): Promise<boolean>
  evaluate(doc: OkcDocument, knownMeshKeys: string[]): Promise<EvaluateResult>
  preview(request: PreviewRequest, knownMeshKeys: string[]): Promise<EvaluateResult>
  exportStep(instanceIds: string[], name: string): Promise<ArrayBuffer>
  meshOf(instanceId: string): Promise<MeshData>
  project(instanceId: string, plane: ProjectionPlane): Promise<ProjectionResult>
  debugProjectPaths(instanceId: string, plane: ProjectionPlane): Promise<string[]>
  clearance(doc: OkcDocument): Promise<Clash[]>
  printPrep(instanceIds: string[], options: PrintOptions): Promise<PrintWarning[]>
  distanceBetween(a: string, b: string): Promise<number | null>
  selfTest(): Promise<{ triangles: number; volume: number; faces: number }>
}
