import type { SVGProps } from 'react'

export function CombineIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="4.99,22.07 16,28.42 16,15.71 4.99,9.36"
        fill="#a9b2bb"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="27.01,22.07 16,28.42 16,15.71 27.01,9.36"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="16,3 27.01,9.36 16,15.71 4.99,9.36"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="5.99,23.22 16,29 16,17.44 5.99,11.67"
        fill="#6fb3e8"
        fillOpacity={0.35}
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="26.01,23.22 16,29 16,17.44 26.01,11.67"
        fill="#6fb3e8"
        fillOpacity={0.35}
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="16,5.89 26.01,11.67 16,17.44 5.99,11.67"
        fill="#6fb3e8"
        fillOpacity={0.35}
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </svg>
  )
}
