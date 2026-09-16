import type { SVGProps } from 'react'

export function ChamferIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="12.08,14.87 3.28,9.78 15.02,3 23.83,8.09"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="16.98,29 16.98,23.35 28.72,16.57 28.72,22.22"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon points="16.98,23.35 12.08,14.87 23.83,8.09 28.72,16.57" fill="#c9d0d7" />
      <polygon
        points="16.98,23.35 12.08,14.87 23.83,8.09 28.72,16.57"
        fill="#6fb3e8"
        fillOpacity={0.35}
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="3.28,21.09 16.98,29 16.98,23.35 12.08,14.87 3.28,9.78"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </svg>
  )
}
