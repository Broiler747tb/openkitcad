import type { SVGProps } from 'react'

export function TorusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <path
        d="M29 16A13 9.98 0 1 1 3 16A13 9.98 0 1 1 29 16ZM21.41 14.92A5.41 2.24 0 1 1 10.59 14.92A5.41 2.24 0 1 1 21.41 14.92Z"
        fill="#a9b2bb"
        fillRule="evenodd"
      />
      <path
        d="M28.09 17.71A12.09 7.98 0 1 1 3.91 17.71A12.09 7.98 0 1 1 28.09 17.71Z"
        fill="none"
      />
      <ellipse
        cx="16"
        cy="14.45"
        rx="9.21"
        ry="5.32"
        fill="none"
        stroke="#c9d0d7"
        strokeWidth={3.13}
      />
      <ellipse cx="16" cy="16" rx="13" ry="9.98" fill="none" stroke="#3c4652" strokeWidth={1.2} />
      <ellipse
        cx="16"
        cy="14.92"
        rx="5.41"
        ry="2.24"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
      />
    </svg>
  )
}
