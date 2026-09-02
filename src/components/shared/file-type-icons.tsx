// =============================================================================
// File-type icons — Office-style brand marks drawn as inline SVG.
// =============================================================================
// Modeled on the Microsoft 365 app icons: a white document page with brand-
// tinted text lines sits behind a gradient rounded tile carrying the app
// letter (W / P / X). PDF and CSV follow the same geometry in their own
// colors so all five read as one family. No external assets, no font
// dependencies beyond system sans-serif — safe to inline anywhere.
// Rendered size: 28×28 (size-7).
// =============================================================================

function OfficeAppIcon({
  gradientId,
  from,
  to,
  letter,
  fontSize,
  tight,
}: {
  gradientId: string;
  from: string;
  to: string;
  letter: string;
  fontSize: number;
  tight?: boolean;
}) {
  return (
    <svg viewBox="0 0 28 28" className="size-7 drop-shadow-sm" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>

      {/* Back page with brand-tinted text lines */}
      <rect x="8.5" y="1.5" width="17.5" height="22.5" rx="2.5" fill="#FFFFFF" />
      <rect
        x="8.5"
        y="1.5"
        width="17.5"
        height="22.5"
        rx="2.5"
        fill="none"
        stroke="#0F172A"
        strokeOpacity="0.08"
      />
      <rect x="12" y="6" width="10.5" height="1.7" rx="0.85" fill={from} opacity="0.45" />
      <rect x="12" y="9.8" width="10.5" height="1.7" rx="0.85" fill={from} opacity="0.45" />
      <rect x="12" y="13.6" width="6.5" height="1.7" rx="0.85" fill={from} opacity="0.45" />

      {/* Front tile with the letter */}
      <rect x="1" y="9.5" width="17" height="17" rx="3.2" fill={`url(#${gradientId})`} />
      <text
        x="9.5"
        y={9.5 + 8.5 + fontSize * 0.36}
        textAnchor="middle"
        fontFamily="Arial, 'Segoe UI', system-ui, sans-serif"
        fontWeight="700"
        fontSize={fontSize}
        letterSpacing={tight ? "-0.3" : undefined}
        fill="#FFFFFF"
      >
        {letter}
      </text>
    </svg>
  );
}

export function WordIcon() {
  return <OfficeAppIcon gradientId="filo-grad-word" from="#45A4F0" to="#1B5CBE" letter="W" fontSize={11.5} />;
}

export function PowerPointIcon() {
  return <OfficeAppIcon gradientId="filo-grad-ppt" from="#F19A63" to="#C13E17" letter="P" fontSize={11.5} />;
}

export function ExcelIcon() {
  return <OfficeAppIcon gradientId="filo-grad-excel" from="#34C77B" to="#0E6B39" letter="X" fontSize={11.5} />;
}

export function PdfIcon() {
  return <OfficeAppIcon gradientId="filo-grad-pdf" from="#EF5350" to="#B91C1C" letter="PDF" fontSize={6.8} tight />;
}

export function CsvIcon() {
  return <OfficeAppIcon gradientId="filo-grad-csv" from="#2DD4BF" to="#0F766E" letter="CSV" fontSize={6.8} tight />;
}
