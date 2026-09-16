import type { SVGProps } from 'react'

export function JointOriginIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="2.64,21.79 16,29.5 16,21.79 2.64,14.07"
        fill="#a9b2bb"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="29.36,21.79 16,29.5 16,21.79 29.36,14.07"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="16,6.36 29.36,14.07 16,21.79 2.64,14.07"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <line
        x1="16"
        y1="14.07"
        x2="21.79"
        y2="17.41"
        stroke="#e8792d"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <polygon
        points="24.28,18.85 20.18,18.77 22.16,15.34"
        fill="#e8792d"
        stroke="#e8792d"
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
      <line
        x1="16"
        y1="14.07"
        x2="10.21"
        y2="17.41"
        stroke="#e8792d"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <polygon
        points="7.72,18.85 9.84,15.34 11.82,18.77"
        fill="#e8792d"
        stroke="#e8792d"
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
      <line
        x1="16"
        y1="14.07"
        x2="16"
        y2="5.38"
        stroke="#e8792d"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <polygon
        points="16,2.5 17.98,6.1 14.02,6.1"
        fill="#e8792d"
        stroke="#e8792d"
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
      <ellipse
        cx="16"
        cy="14.07"
        rx="1.32"
        ry="0.76"
        fill="#e8792d"
        stroke="#e8792d"
        strokeWidth={1.2}
      />
    </svg>
  )
}
