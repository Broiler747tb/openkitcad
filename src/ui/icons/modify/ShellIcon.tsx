import type { SVGProps } from 'react'

export function ShellIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="16,13.85 24.91,19 16,24.15 7.09,19"
        fill="#a9b2bb"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="16,13.85 7.09,19 7.09,10.64 16,5.49"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="16,13.85 24.91,19 24.91,10.64 16,5.49"
        fill="#a9b2bb"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="3,21.36 16,28.87 16,18.15 3,10.64"
        fill="#a9b2bb"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="29,21.36 16,28.87 16,18.15 29,10.64"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <path
        d="M16 3.13L29 10.64L16 18.15L3 10.64ZM16 5.49L24.91 10.64L16 15.79L7.09 10.64Z"
        fill="#c9d0d7"
        fillRule="evenodd"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </svg>
  )
}
