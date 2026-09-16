import type { SVGProps } from 'react'

export function StitchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="16,14.92 28.2,21.96 16,29 3.8,21.96"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="16,14.92 3.8,21.96 3.8,10.04 16,3"
        fill="#6fb3e8"
        fillOpacity={0.35}
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <line
        x1="17.85"
        y1="16.44"
        x2="13.35"
        y2="13.84"
        stroke="#e8792d"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <line
        x1="14.81"
        y1="18.21"
        x2="10.3"
        y2="15.61"
        stroke="#e8792d"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <line
        x1="11.75"
        y1="19.96"
        x2="7.25"
        y2="17.36"
        stroke="#e8792d"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <line
        x1="8.71"
        y1="21.73"
        x2="4.2"
        y2="19.13"
        stroke="#e8792d"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  )
}
