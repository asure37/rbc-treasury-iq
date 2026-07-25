export function Mark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" className="shrink-0">
      <defs>
        <linearGradient id="mark-grad" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5ce1ff" />
          <stop offset="1" stopColor="#0051a5" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="34" height="34" rx="9" stroke="url(#mark-grad)" strokeWidth="1.5" />
      <path d="M18 6 L28 12 V24 L18 30 L8 24 V12 Z" fill="url(#mark-grad)" fillOpacity="0.18" stroke="url(#mark-grad)" strokeWidth="1.3" />
      <path d="M18 12 L18 24 M13 15 L23 21 M23 15 L13 21" stroke="url(#mark-grad)" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
