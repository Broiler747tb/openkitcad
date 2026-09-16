import type { SVGProps } from 'react'

export function DraftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon points="16.49,29 12.17,13.23 22.72,7.15 27.02,22.91" fill="#8a949e" />
      <polygon
        points="16.49,29 12.17,13.23 22.72,7.15 27.02,22.91"
        fill="#6fb3e8"
        fillOpacity={0.35}
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="12.17,13.23 4.98,9.09 15.52,3 22.72,7.15"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="4.98,22.36 16.49,29 12.17,13.23 4.98,9.09"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <line
        x1="16.49"
        y1="29"
        x2="16.49"
        y2="13.51"
        stroke="#1676c5"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeDasharray="2 2"
      />
      <path
        d="M16.49 18.49L16.15 18.31L15.83 18.14L15.5 17.98L15.18 17.85L14.86 17.71L14.54 17.6L14.22 17.52L13.91 17.43L13.6 17.36L13.29 17.32"
        fill="none"
        stroke="#e8792d"
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
