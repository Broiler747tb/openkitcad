import type { SVGProps } from 'react'

export function SurfaceRevolveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <line
        x1="19.56"
        y1="24.78"
        x2="19.56"
        y2="4.59"
        stroke="#1676c5"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeDasharray="2 2"
      />
      <polygon
        points="29,24.13 28.1,25.03 26.93,25.84 25.54,26.51 23.96,27.04 22.26,27.39 20.47,27.58 18.66,27.58 16.87,27.39 15.17,27.04 13.59,26.51 12.2,25.84 11.03,25.03 10.13,24.13 9.51,23.14 9.19,22.11 9.19,21.07 9.51,20.04 10.13,19.05 10.13,7.36 9.51,8.35 9.19,9.38 9.19,10.42 9.51,11.45 10.13,12.44 11.03,13.34 12.2,14.15 13.59,14.82 15.17,15.35 16.87,15.7 18.66,15.89 20.47,15.89 22.26,15.7 23.96,15.35 25.54,14.82 26.93,14.15 28.1,13.34 29,12.44"
        fill="#6fb3e8"
        fillOpacity={0.35}
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <line
        x1="29"
        y1="24.13"
        x2="29"
        y2="12.44"
        stroke="#1676c5"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <path
        d="M18.32 15.48A14.31 8.27 0 0 1 5.34 6.34"
        fill="none"
        stroke="#e8792d"
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <polygon
        points="6.11,4.42 7.31,8.5 3,7.31"
        fill="#e8792d"
        stroke="#e8792d"
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
    </svg>
  )
}
