import type { SVGProps } from 'react'

export function AsBuiltJointIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="2.5,20.83 16,28.63 16,24.57 2.5,16.78"
        fill="#a9b2bb"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="29.5,20.83 16,28.63 16,24.57 29.5,16.78"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="16,8.99 29.5,16.78 16,24.57 2.5,16.78"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <ellipse
        cx="16"
        cy="16.78"
        rx="8.78"
        ry="5.07"
        fill="none"
        stroke="#e8792d"
        strokeWidth={1.6}
      />
      <polygon
        points="10.06,16.78 16,20.21 16,13.35 10.06,9.92"
        fill="#a9b2bb"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="21.94,16.78 16,20.21 16,13.35 21.94,9.92"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="16,6.49 21.94,9.92 16,13.35 10.06,9.92"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <line
        x1="16"
        y1="9.92"
        x2="16"
        y2="3.37"
        stroke="#e8792d"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <ellipse
        cx="16"
        cy="9.92"
        rx="2.67"
        ry="1.54"
        fill="none"
        stroke="#e8792d"
        strokeWidth={1.4}
      />
    </svg>
  )
}
