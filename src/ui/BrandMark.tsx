export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role="img"
      aria-label="OpenKitCAD"
    >
      <rect x="1" y="1" width="30" height="30" rx="7" fill="#1676c5" />
      <path d="M7 15.5L16 20.5L25 15.5V24.5L16 29.5L7 24.5Z" fill="#ffffff" fillOpacity={0.22} />
      <path
        d="M7 15.5L16 20.5L25 15.5M16 20.5V29.5M7 15.5V24.5L16 29.5L25 24.5V15.5"
        fill="none"
        stroke="#ffffff"
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <path
        d="M7 15.5L16 10.5L25 15.5"
        fill="none"
        stroke="#ffffff"
        strokeWidth={1.7}
        strokeLinejoin="round"
        strokeDasharray="2.2 1.8"
      />
      <path
        d="M16 10.5L20.5 4L29 8.5L25 15.5Z"
        fill="#ffffff"
        stroke="#ffffff"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </svg>
  )
}
