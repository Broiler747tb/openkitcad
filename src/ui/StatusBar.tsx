import { UNIT_NAME } from '../core/units'
import { useStore } from '../doc/store'

export function StatusBar() {
  const building = useStore((s) => s.building)
  const buildMs = useStore((s) => s.buildMs)
  const instances = useStore((s) => s.instances)
  const meshes = useStore((s) => s.meshes)
  const errors = useStore((s) => s.errors)
  const units = useStore((s) => s.doc.units)
  const status = useStore((s) => s.statusMessage)
  const showPlacements = useStore((s) => s.showPlacements)
  const showFasteners = useStore((s) => s.showFasteners)

  const shapes = instances.filter((instance) => instance.visible)
  const triangles = shapes.reduce(
    (n, instance) => n + (meshes.get(instance.meshKey)?.mesh.triangles.length ?? 0) / 3,
    0,
  )
  const failures = errors.filter((error) => error.severity === 'error')

  return (
    <div className="statusbar">
      <span className="engine-state" title={`Last rebuild: ${buildMs} ms`}>
        {building ? 'Updating geometry…' : '● Ready'}
      </span>
      <span>
        {shapes.length} shape{shapes.length === 1 ? '' : 's'}
      </span>
      <span className="mesh-stat">{triangles.toLocaleString()} triangles</span>
      {failures.length > 0 && (
        <span style={{ color: 'var(--err)' }}>
          {failures.length} step{failures.length === 1 ? '' : 's'} need attention
        </span>
      )}
      {status && <span style={{ color: 'var(--warn)' }}>{status}</span>}
      <span className="spacer" />
      <label className="status-toggle">
        <input
          type="checkbox"
          checked={showPlacements}
          onChange={(e) => useStore.getState().setShowPlacements(e.target.checked)}
        />
        Show catalog parts
      </label>
      <label className="status-toggle">
        <input
          type="checkbox"
          checked={showFasteners}
          onChange={(e) => useStore.getState().setShowFasteners(e.target.checked)}
        />
        Show screws
      </label>
      <span>{UNIT_NAME[units].toLowerCase()}</span>
    </div>
  )
}
