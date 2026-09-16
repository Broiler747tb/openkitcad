import type { SVGProps } from 'react'

export function ScaleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="9.94,19.5 16,23 16,16 9.94,12.5"
        fill="#a9b2bb"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="22.06,19.5 16,23 16,16 22.06,12.5"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="16,9 22.06,12.5 16,16 9.94,12.5"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="4.74,22.5 16,29 16,16 4.74,9.5"
        fill="#6fb3e8"
        fillOpacity={0.35}
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="27.26,22.5 16,29 16,16 27.26,9.5"
        fill="#6fb3e8"
        fillOpacity={0.35}
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="16,3 27.26,9.5 16,16 4.74,9.5"
        fill="#6fb3e8"
        fillOpacity={0.35}
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <line
        x1="16"
        y1="16"
        x2="16"
        y2="16"
        stroke="#e8792d"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <polygon
        points="16,16 16,16 16,16"
        fill="#e8792d"
        stroke="#e8792d"
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
    </svg>
  )
}
