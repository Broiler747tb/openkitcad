import type { SVGProps } from 'react'

export function JointIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="4.81,23.04 16,29.5 16,26.14 4.81,19.68"
        fill="#a9b2bb"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="27.19,23.04 16,29.5 16,26.14 27.19,19.68"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="16,13.22 27.19,19.68 16,26.14 4.81,19.68"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <ellipse
        cx="16"
        cy="19.68"
        rx="4.27"
        ry="2.47"
        fill="none"
        stroke="#e8792d"
        strokeWidth={1.6}
      />
      <line
        x1="16"
        y1="9.86"
        x2="16"
        y2="15.81"
        stroke="#e8792d"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <polygon
        points="16,19.17 13.69,14.97 18.31,14.97"
        fill="#e8792d"
        stroke="#e8792d"
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
      <polygon
        points="11.08,10.77 16,13.61 16,8.18 11.08,5.34"
        fill="#a9b2bb"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="20.92,10.77 16,13.61 16,8.18 20.92,5.34"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="16,2.5 20.92,5.34 16,8.18 11.08,5.34"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </svg>
  )
}
