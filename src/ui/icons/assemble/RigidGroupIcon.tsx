import type { SVGProps } from 'react'

export function RigidGroupIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="2.5,20.2 8.37,23.59 8.37,15.19 2.5,11.8"
        fill="#a9b2bb"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="14.24,20.2 8.37,23.59 8.37,15.19 14.24,11.8"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="8.37,8.41 14.24,11.8 8.37,15.19 2.5,11.8"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="17.76,20.2 23.63,23.59 23.63,15.19 17.76,11.8"
        fill="#a9b2bb"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="29.5,20.2 23.63,23.59 23.63,15.19 29.5,11.8"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="23.63,8.41 29.5,11.8 23.63,15.19 17.76,11.8"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <line
        x1="8.37"
        y1="11.8"
        x2="23.63"
        y2="11.8"
        stroke="#e8792d"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <ellipse
        cx="8.37"
        cy="11.8"
        rx="1.66"
        ry="0.96"
        fill="#e8792d"
        stroke="#e8792d"
        strokeWidth={1.4}
      />
      <ellipse
        cx="23.63"
        cy="11.8"
        rx="1.66"
        ry="0.96"
        fill="#e8792d"
        stroke="#e8792d"
        strokeWidth={1.4}
      />
    </svg>
  )
}
