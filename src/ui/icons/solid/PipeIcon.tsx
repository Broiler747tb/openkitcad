import type { SVGProps } from 'react'

export function PipeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="6.92,21.61 14.45,17.26 14.94,17.02 15.46,16.87 16.08,16.76 16.76,16.72 17.44,16.76 18.07,16.87 18.59,17.02 19.08,17.26 22.78,19.41 26.03,13.79 22.1,11.52 20.94,10.98 19.59,10.56 18.19,10.31 16.76,10.23 15.33,10.31 13.94,10.56 12.59,10.98 11.43,11.52 3.67,16"
        fill="#6fb3e8"
        fillOpacity={0.35}
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <path
        d="M12.94 14.39L13.76 14L14.7 13.71L15.71 13.54L16.76 13.47L17.81 13.54L18.83 13.71L19.76 14L20.59 14.39L24.41 16.6L29 19.25"
        fill="none"
        stroke="#1676c5"
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M6.92 21.61A3.24 1.87 60 1 1 3.67 16A3.24 1.87 60 1 1 6.92 21.61Z"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M6.19 20.35A1.78 1.03 60 1 1 4.4 17.26A1.78 1.03 60 1 1 6.19 20.35Z"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
