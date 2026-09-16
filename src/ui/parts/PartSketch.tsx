import type { ReactNode } from 'react'
import {
  CATEGORY_COLOUR,
  partFootprint,
  type CataloguePart,
  type PartGeometry,
} from '../../catalogue'

const STEEL = '#b9c0c7'
const STEEL_DARK = '#8e969e'
const BRASS = '#c9a24a'
const BLACK = '#1d2126'
const PIN = '#d8b75a'
const EDGE = 'rgba(0, 0, 0, 0.35)'
const CUT = { fill: 'var(--okc-surface-sunken)', stroke: EDGE }

interface Drawing {
  box: [number, number, number, number]
  content: ReactNode
}

function line(props: { fill?: string; stroke?: string; style?: object }) {
  return { strokeWidth: 1, vectorEffect: 'non-scaling-stroke' as const, stroke: EDGE, ...props }
}

function board(part: CataloguePart, g: Extract<PartGeometry, { kind: 'board' }>): Drawing {
  const { w, h } = partFootprint(part)
  const colour = CATEGORY_COLOUR[part.category]
  const outline =
    g.outline.shape === 'rect' ? (
      <rect
        width={g.outline.w}
        height={g.outline.h}
        rx={g.outline.cornerRadius ?? 0}
        {...line({ fill: colour })}
      />
    ) : (
      <polygon
        points={g.outline.points.map((p) => p.join(',')).join(' ')}
        {...line({ fill: colour })}
      />
    )
  const bumps = [...(g.bumps ?? [])]
    .filter((bump) => bump.z >= 0)
    .sort((a, b) => a.z + a.height - (b.z + b.height))
  return {
    box: [0, 0, w, h],
    content: (
      <>
        {outline}
        {(part.mountingHoles ?? []).map((hole) => (
          <circle
            key={`pad-${hole.id}`}
            cx={hole.x}
            cy={hole.y}
            r={hole.diameter / 2 + 0.9}
            {...line({ fill: PIN, stroke: 'none' })}
          />
        ))}
        {bumps.map((bump, i) => (
          <rect
            key={`bump-${i}`}
            x={bump.x}
            y={bump.y}
            width={bump.w}
            height={bump.h}
            rx={Math.min(bump.w, bump.h) * 0.06}
            {...line({ fill: bump.colour })}
          />
        ))}
        {(part.pinHeaders ?? []).flatMap((header) =>
          Array.from({ length: header.rows * header.cols }, (_, i) => (
            <rect
              key={`${header.id}-${i}`}
              x={header.x + (i % header.cols) * header.pitch - header.pitch * 0.18}
              y={header.y + Math.floor(i / header.cols) * header.pitch - header.pitch * 0.18}
              width={header.pitch * 0.36}
              height={header.pitch * 0.36}
              fill={PIN}
            />
          )),
        )}
        {(part.mountingHoles ?? []).map((hole) => (
          <circle
            key={hole.id}
            cx={hole.x}
            cy={hole.y}
            r={hole.diameter / 2}
            {...line({})}
            style={CUT}
          />
        ))}
      </>
    ),
  }
}

function connector(part: CataloguePart, g: Extract<PartGeometry, { kind: 'connector' }>): Drawing {
  const { bodyWidth: w, bodyHeight: h, cutout } = g
  const cw = cutout.shape === 'circle' ? cutout.d : cutout.w
  const ch = cutout.shape === 'circle' ? cutout.d : cutout.h
  return {
    box: [
      Math.min(0, (w - cw) / 2),
      Math.min(0, (h - ch) / 2),
      Math.max(w, (w + cw) / 2),
      Math.max(h, (h + ch) / 2),
    ],
    content: (
      <>
        <rect width={w} height={h} rx={Math.min(w, h) * 0.08} {...line({ fill: STEEL })} />
        {cutout.shape === 'circle' ? (
          <>
            <circle cx={w / 2} cy={h / 2} r={cutout.d / 2} {...line({ fill: STEEL_DARK })} />
            <circle cx={w / 2} cy={h / 2} r={cutout.d * 0.3} {...line({ fill: BLACK })} />
          </>
        ) : (
          <>
            <rect
              x={(w - cutout.w) / 2}
              y={(h - cutout.h) / 2}
              width={cutout.w}
              height={cutout.h}
              rx={cutout.cornerRadius ?? 0}
              {...line({ fill: BLACK })}
            />
            <rect
              x={(w - cutout.w * 0.62) / 2}
              y={(h - cutout.h * 0.3) / 2}
              width={cutout.w * 0.62}
              height={cutout.h * 0.3}
              rx={Math.min(cutout.w, cutout.h) * 0.08}
              {...line({ fill: STEEL_DARK, stroke: 'none' })}
            />
          </>
        )}
        {(part.mountingHoles ?? []).map((hole) => (
          <circle
            key={hole.id}
            cx={hole.x}
            cy={hole.y}
            r={hole.diameter / 2}
            {...line({})}
            style={CUT}
          />
        ))}
      </>
    ),
  }
}

function drawing(part: CataloguePart): Drawing {
  const g = part.geometry
  switch (g.kind) {
    case 'board':
      return board(part, g)
    case 'connector':
      return connector(part, g)
    case 'screw': {
      const r = g.headDiameter / 2
      const top = g.head === 'countersunk' ? g.length : g.length + g.headHeight
      const threads = Math.max(2, Math.round(g.length / Math.max(g.diameter * 0.17, 0.35)))
      return {
        box: [0, 0, g.headDiameter, top],
        content: (
          <>
            <rect
              x={r - g.diameter / 2}
              width={g.diameter}
              height={g.length}
              {...line({ fill: STEEL })}
            />
            {Array.from({ length: threads }, (_, i) => (
              <line
                key={i}
                x1={r - g.diameter / 2}
                x2={r + g.diameter / 2}
                y1={((i + 0.5) * (g.length - g.headHeight * 0.2)) / threads}
                y2={((i + 0.9) * (g.length - g.headHeight * 0.2)) / threads}
                {...line({ stroke: STEEL_DARK })}
              />
            ))}
            {g.head === 'countersunk' ? (
              <polygon
                points={`${r - g.diameter / 2},${g.length - g.headHeight} ${r + g.diameter / 2},${g.length - g.headHeight} ${g.headDiameter},${g.length} 0,${g.length}`}
                {...line({ fill: STEEL })}
              />
            ) : (
              <rect
                y={g.length}
                width={g.headDiameter}
                height={g.headHeight}
                rx={
                  g.head === 'button' || g.head === 'pan' ? g.headHeight * 0.5 : g.headHeight * 0.12
                }
                {...line({ fill: STEEL })}
              />
            )}
          </>
        ),
      }
    }
    case 'insert': {
      const knurls = Math.max(3, Math.round(g.length / 0.9))
      return {
        box: [0, 0, g.outerDiameter, g.length],
        content: (
          <>
            <rect width={g.outerDiameter} height={g.length} rx={0.2} {...line({ fill: BRASS })} />
            {Array.from({ length: knurls }, (_, i) => (
              <line
                key={i}
                x1={0}
                x2={g.outerDiameter}
                y1={(i * g.length) / knurls}
                y2={((i + 1) * g.length) / knurls}
                {...line({ stroke: 'rgba(90, 60, 10, 0.45)' })}
              />
            ))}
          </>
        ),
      }
    }
    case 'standoff': {
      const a = g.acrossFlats
      return {
        box: [0, 0, a, g.length],
        content: (
          <>
            <rect width={a} height={g.length} {...line({ fill: BRASS })} />
            <rect x={a * 0.25} width={a * 0.5} height={g.length} {...line({ fill: '#dcb862' })} />
          </>
        ),
      }
    }
    case 'motor': {
      const f = g.frame
      return {
        box: [0, 0, f, f],
        content: (
          <>
            <rect width={f} height={f} rx={4} {...line({ fill: CATEGORY_COLOUR.motor })} />
            <circle cx={f / 2} cy={f / 2} r={g.bossDiameter / 2} {...line({ fill: STEEL })} />
            <circle cx={f / 2} cy={f / 2} r={g.shaftDiameter / 2} {...line({ fill: '#e3e7ea' })} />
            {(part.mountingHoles ?? []).map((hole) => (
              <circle
                key={hole.id}
                cx={hole.x}
                cy={hole.y}
                r={hole.diameter / 2}
                {...line({})}
                style={CUT}
              />
            ))}
          </>
        ),
      }
    }
    case 'bearing': {
      const r = g.outerDiameter / 2
      return {
        box: [0, 0, g.outerDiameter, g.outerDiameter],
        content: (
          <>
            <circle cx={r} cy={r} r={r} {...line({ fill: STEEL })} />
            <circle
              cx={r}
              cy={r}
              r={(r + g.innerDiameter / 2) / 2 + r * 0.12}
              {...line({ fill: BLACK })}
            />
            <circle cx={r} cy={r} r={g.innerDiameter / 2 + r * 0.1} {...line({ fill: STEEL })} />
            <circle cx={r} cy={r} r={g.innerDiameter / 2} {...line({})} style={CUT} />
          </>
        ),
      }
    }
    case 'extrusion': {
      const s = g.size
      const c = s / 2
      const slot = `M ${c - 3} ${s} L ${c - 3} ${s - 6} L ${c - 5.5} ${s - 6} L ${c - 5.5} ${s - 11} L ${c + 5.5} ${s - 11} L ${c + 5.5} ${s - 6} L ${c + 3} ${s - 6} L ${c + 3} ${s} Z`
      return {
        box: [0, 0, s, s],
        content: (
          <>
            <rect width={s} height={s} rx={s * 0.05} {...line({ fill: '#aab1b8' })} />
            {Array.from({ length: g.slots ?? 4 }, (_, i) => (
              <path
                key={i}
                d={slot}
                transform={`rotate(${i * 90} ${c} ${c})`}
                {...line({})}
                style={CUT}
              />
            ))}
            <circle cx={c} cy={c} r={2.1} {...line({})} style={CUT} />
          </>
        ),
      }
    }
  }
}

export function sketchSpan(part: CataloguePart): number {
  const [x0, y0, x1, y1] = drawing(part).box
  return Math.max(x1 - x0, y1 - y0)
}

export function PartSketch({
  part,
  className,
  span,
}: {
  part: CataloguePart
  className?: string
  span?: number
}) {
  const { box, content } = drawing(part)
  const [x0, y0, x1, y1] = box
  const size = Math.max(span ?? 0, x1 - x0, y1 - y0) * 1.12
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  return (
    <svg
      className={className}
      viewBox={`${cx - size / 2} ${-cy - size / 2} ${size} ${size}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <g transform="scale(1,-1)">{content}</g>
    </svg>
  )
}
