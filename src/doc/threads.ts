export interface MetricThread {
  nominal: number
  coarse: number
  fine: number[]
}

export const METRIC_THREADS: readonly MetricThread[] = [
  { nominal: 1.6, coarse: 0.35, fine: [0.2] },
  { nominal: 2, coarse: 0.4, fine: [0.25] },
  { nominal: 2.5, coarse: 0.45, fine: [0.35] },
  { nominal: 3, coarse: 0.5, fine: [0.35] },
  { nominal: 4, coarse: 0.7, fine: [0.5] },
  { nominal: 5, coarse: 0.8, fine: [0.5] },
  { nominal: 6, coarse: 1, fine: [0.75] },
  { nominal: 8, coarse: 1.25, fine: [1, 0.75] },
  { nominal: 10, coarse: 1.5, fine: [1.25, 1, 0.75] },
  { nominal: 12, coarse: 1.75, fine: [1.5, 1.25, 1] },
  { nominal: 14, coarse: 2, fine: [1.5, 1.25, 1] },
  { nominal: 16, coarse: 2, fine: [1.5, 1] },
  { nominal: 18, coarse: 2.5, fine: [2, 1.5, 1] },
  { nominal: 20, coarse: 2.5, fine: [2, 1.5, 1] },
  { nominal: 22, coarse: 2.5, fine: [2, 1.5, 1] },
  { nominal: 24, coarse: 3, fine: [2, 1.5, 1] },
  { nominal: 27, coarse: 3, fine: [2, 1.5, 1] },
  { nominal: 30, coarse: 3.5, fine: [2, 1.5, 1] },
  { nominal: 33, coarse: 3.5, fine: [2, 1.5] },
  { nominal: 36, coarse: 4, fine: [3, 2, 1.5] },
  { nominal: 39, coarse: 4, fine: [3, 2, 1.5] },
  { nominal: 42, coarse: 4.5, fine: [3, 2, 1.5] },
  { nominal: 45, coarse: 4.5, fine: [3, 2, 1.5] },
  { nominal: 48, coarse: 5, fine: [3, 2, 1.5] },
  { nominal: 52, coarse: 5, fine: [3, 2, 1.5] },
  { nominal: 56, coarse: 5.5, fine: [4, 3, 2, 1.5] },
  { nominal: 60, coarse: 5.5, fine: [4, 3, 2, 1.5] },
  { nominal: 64, coarse: 6, fine: [4, 3, 2, 1.5] },
]

export interface ThreadChoice {
  value: string
  nominal: number
  pitch: number
}

export const THREAD_DEPTH = 0.541266
export const CREST_FLAT = 0.125
export const ROOT_FLAT = 0.25

export function threadDepth(pitch: number): number {
  return THREAD_DEPTH * pitch
}

export function minorDiameter(nominal: number, pitch: number): number {
  return nominal - 2 * threadDepth(pitch)
}

export function tapDrill(nominal: number, pitch: number): number {
  return Math.round((nominal - pitch) * 100) / 100
}

export function pitchesOf(nominal: number): number[] {
  const entry = METRIC_THREADS.find((thread) => thread.nominal === nominal)
  return entry ? [entry.coarse, ...entry.fine] : []
}

export function isCoarse(nominal: number, pitch: number): boolean {
  return METRIC_THREADS.find((thread) => thread.nominal === nominal)?.coarse === pitch
}

export function designation(nominal: number, pitch: number): string {
  const size = `M${Number(nominal.toFixed(2))}`
  return isCoarse(nominal, pitch) ? size : `${size}x${Number(pitch.toFixed(2))}`
}

export const THREAD_CHOICES: readonly ThreadChoice[] = METRIC_THREADS.flatMap((thread) =>
  [thread.coarse, ...thread.fine].map((pitch) => ({
    value: designation(thread.nominal, pitch),
    nominal: thread.nominal,
    pitch,
  })),
)

export function nearestThread(diameter: number, internal: boolean): MetricThread {
  let best = METRIC_THREADS[0]
  let gap = Infinity
  for (const thread of METRIC_THREADS) {
    const size = internal ? minorDiameter(thread.nominal, thread.coarse) : thread.nominal
    const distance = Math.abs(size - diameter)
    if (distance < gap) {
      gap = distance
      best = thread
    }
  }
  return best
}
