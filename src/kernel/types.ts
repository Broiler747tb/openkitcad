/**
 * Types shared across the worker boundary.
 *
 * Everything here must be structured-cloneable: no classes, no functions, no
 * replicad objects. The worker owns all B-rep shapes; the main thread only ever
 * sees triangles, line segments and plain numbers.
 */

/** Tessellated solid ready to hand to three.js. */
export interface MeshData {
  /** Flat xyz triples. */
  vertices: Float32Array
  /** Triangle indices into `vertices`. */
  triangles: Uint32Array
  /** Flat xyz normal triples, parallel to `vertices`. */
  normals: Float32Array
  /**
   * Maps a B-rep face to its triangle range, so clicking a triangle can resolve
   * which face was hit.
   */
  faceGroups: Array<{ start: number; count: number; faceId: number }>
}

/** Tessellated edges, drawn as crisp lines over the shaded mesh. */
export interface EdgeData {
  /** Flat xyz pairs forming line segments. */
  lines: Float32Array
  edgeGroups: Array<{ start: number; count: number; edgeId: number }>
}

export type ShapeKind = 'body' | 'placement'

/** A fully evaluated solid: what the viewport needs to draw one thing. */
export interface ShapeResult {
  id: string
  kind: ShapeKind
  name: string
  colour: string
  mesh: MeshData
  edges: EdgeData
  /** Millimetres cubed. */
  volume: number
  /** Axis-aligned bounds as [minX, minY, minZ, maxX, maxY, maxZ]. */
  bounds: [number, number, number, number, number, number]
}

/** Raised when a feature cannot be evaluated, surfaced in the feature tree. */
export interface KernelError {
  featureId: string
  bodyId: string
  message: string
  /** Plain-English suggestion shown to beginners under the raw message. */
  hint?: string
}

export interface EvaluateResult {
  shapes: ShapeResult[]
  errors: KernelError[]
  /** Wall-clock milliseconds spent in the kernel, shown in the status bar. */
  elapsedMs: number
}

export type ExportFormat = 'step' | 'stl' | 'stl-ascii' | '3mf' | 'dxf' | 'svg' | 'pdf'

/** Flattened 2D geometry, used by the DXF, SVG and drill-template exporters. */
export interface ProjectionResult {
  /** Polylines in the projection plane. */
  polylines: Array<Array<[number, number]>>
  /** Subpaths recognised as true circles, so DXF gets real CIRCLE entities. */
  circles: Array<{ cx: number; cy: number; r: number }>
  bounds: [number, number, number, number]
}

/** One clash found by the clearance checker. */
export interface Clash {
  aLabel: string
  bLabel: string
  /** Roughly how deep the overlap is, in mm. */
  overlap: number
  /** Centre of the overlap region, for the viewport marker. */
  at: [number, number, number]
}

/** One thing that will go wrong on the printer. */
export interface PrintWarning {
  shapeId: string
  shapeName: string
  severity: 'error' | 'warning' | 'info'
  message: string
  hint?: string
}
