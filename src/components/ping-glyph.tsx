import type { PingColor } from "@/lib/quire/map-announcements";

const paths: Record<PingColor, string> = {
  red: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z",
  amber: "M4 4h16v16H4z",
  green: "M12 2.5L22 20.5H2z",
  blue: "M12 1.5L22.5 12L12 22.5L1.5 12z",
  violet: "M12 1.5l3 7.1l7.6.6l-5.8 5l1.8 7.4L12 17.6l-6.6 4l1.8-7.4l-5.8-5l7.6-.6z",
};
/** Each ping colour also has its own shape, so pings never differ by hue alone. */
export function PingGlyph({ color }: { color: PingColor }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <path
        d={paths[color]}
        fill="var(--ping-color)"
        stroke="white"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
