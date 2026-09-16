import type { SVGProps } from 'react'

export function SweepIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="6.12,5.51 6.12,13.47 6.28,15.32 6.74,17.33 7.45,19.3 8.4,21.16 9.54,22.92 10.89,24.52 12.4,25.92 13.92,26.98 16.96,28.73 21.31,21.2 18.58,19.62 17.86,19.12 17.2,18.52 16.54,17.73 15.94,16.81 15.44,15.83 15.09,14.86 14.89,13.99 14.83,13.12 14.83,5.51"
        fill="#6fb3e8"
        fillOpacity={0.35}
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <path
        d="M21.31 21.2A4.36 2.51 -60 1 1 16.96 28.73A4.36 2.51 -60 1 1 21.31 21.2Z"
        fill="#6fb3e8"
        fillOpacity={0.35}
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M10.48 5.51L10.48 13.29L10.59 14.66L10.92 16.1L11.45 17.56L12.16 18.99L13.04 20.32L14.04 21.52L15.12 22.52L16.26 23.3L25.88 28.86"
        fill="none"
        stroke="#1676c5"
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <ellipse
        cx="10.48"
        cy="5.51"
        rx="4.36"
        ry="2.51"
        fill="none"
        stroke="#1676c5"
        strokeWidth={1.8}
      />
    </svg>
  )
}
