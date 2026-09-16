import type { SVGProps } from 'react'

export function ExtrudeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="5.19,22.76 16,29 16,19.64 5.19,13.4"
        fill="#6fb3e8"
        fillOpacity={0.35}
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="26.81,22.76 16,29 16,19.64 26.81,13.4"
        fill="#6fb3e8"
        fillOpacity={0.35}
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="16,7.16 26.81,13.4 16,19.64 5.19,13.4"
        fill="#6fb3e8"
        fillOpacity={0.35}
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <path
        d="M16 16.52L26.81 22.76L16 29L5.19 22.76Z"
        fill="none"
        stroke="#1676c5"
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <line
        x1="16"
        y1="13.4"
        x2="16"
        y2="6.33"
        stroke="#e8792d"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <polygon
        points="16,3 18.32,6.74 13.68,6.74"
        fill="#e8792d"
        stroke="#e8792d"
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
    </svg>
  )
}
