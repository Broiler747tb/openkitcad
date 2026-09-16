import type { SVGProps } from 'react'

export function ChangeParametersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="3.21,24 11,28.5 11,19.5 3.21,15"
        fill="#a9b2bb"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="18.79,24 11,28.5 11,19.5 18.79,15"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="11,10.5 18.79,15 11,19.5 3.21,15"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <line
        x1="22.5"
        y1="21.4"
        x2="22.5"
        y2="17.6"
        stroke="#e8792d"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <polygon
        points="22.5,15 24.36,18 20.64,18"
        fill="#e8792d"
        stroke="#e8792d"
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
      <polygon
        points="22.5,24 20.64,21 24.36,21"
        fill="#e8792d"
        stroke="#e8792d"
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
      <path
        d="M25 3.2C23.2 2.7 22.1 3.7 21.8 5.4L20.4 12.8"
        fill="none"
        stroke="#1676c5"
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <line
        x1="19.6"
        y1="6.6"
        x2="24.2"
        y2="6.6"
        stroke="#1676c5"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <line
        x1="24.2"
        y1="8"
        x2="29"
        y2="12.8"
        stroke="#1676c5"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <line
        x1="29"
        y1="8"
        x2="24.2"
        y2="12.8"
        stroke="#1676c5"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  )
}
