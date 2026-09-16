import type { SVGProps } from 'react'

export function MeshSmoothIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <path
        d="M2.5 11.41L2.5 20.59A13.5 7.79 0 0 0 29.5 20.59L29.5 11.41Z"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <ellipse
        cx="16"
        cy="11.41"
        rx="13.5"
        ry="7.79"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
      />
      <ellipse
        cx="16"
        cy="11.41"
        rx="9.45"
        ry="5.46"
        fill="none"
        stroke="#e8792d"
        strokeWidth={1.6}
      />
      <ellipse
        cx="16"
        cy="11.41"
        rx="4.95"
        ry="2.86"
        fill="none"
        stroke="#e8792d"
        strokeWidth={1.6}
      />
    </svg>
  )
}
