import type { SVGProps } from 'react'

export function MountingHolesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="3,18.21 18.3,27.04 18.3,24.83 3,16"
        fill="#a9b2bb"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="29,20.86 18.3,27.04 18.3,24.83 29,18.65"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="13.7,9.82 29,18.65 18.3,24.83 3,16"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <ellipse cx="13.7" cy="12.47" rx="1.73" ry="1" fill="#3c4652" />
      <line
        x1="13.7"
        y1="12.47"
        x2="13.7"
        y2="4.96"
        stroke="#1676c5"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeDasharray="2 2"
      />
      <ellipse cx="24.41" cy="18.65" rx="1.73" ry="1" fill="#3c4652" />
      <line
        x1="24.41"
        y1="18.65"
        x2="24.41"
        y2="11.14"
        stroke="#1676c5"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeDasharray="2 2"
      />
      <ellipse cx="7.58" cy="16" rx="1.73" ry="1" fill="#3c4652" />
      <line
        x1="7.58"
        y1="16"
        x2="7.58"
        y2="8.49"
        stroke="#1676c5"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeDasharray="2 2"
      />
      <ellipse cx="18.3" cy="22.18" rx="1.73" ry="1" fill="#3c4652" />
      <line
        x1="18.3"
        y1="22.18"
        x2="18.3"
        y2="14.68"
        stroke="#1676c5"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeDasharray="2 2"
      />
    </svg>
  )
}
