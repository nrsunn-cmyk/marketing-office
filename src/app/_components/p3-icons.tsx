/**
 * P3 화면 아이콘·빈 상태 그림·상태 배지 — AGY SVG 원본을 그대로 옮긴 인라인 부품.
 * 원본: C:/nadaum/Design/assets/p3-p4/(ASSETS-HANDOFF.md, DESIGN-P3-ASSETS-01). 경로·속성은 바꾸지 않는다.
 * <img> 로 넣으면 currentColor 가 글자색을 따르지 않아 어두운 화면에서 검게 보이므로 인라인으로 쓴다.
 * 모두 장식용(aria-hidden). 뜻은 옆 글자로 전한다.
 */
import type { SVGProps } from "react";

type P = Omit<SVGProps<SVGSVGElement>, "viewBox" | "children">;

const base24 = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
} as const;

/** icons/p3-assets.svg — 디자인 자산 관리 아이콘 */
export function P3AssetsIcon({ width = 24, height = 24, ...p }: P) {
  return (
    <svg {...base24} width={width} height={height} {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 16l-5-5-6 6-2-2-5 5" />
    </svg>
  );
}

/** icons/p3-video.svg — 영상 구성·파일 아이콘 */
export function P3VideoIcon({ width = 24, height = 24, ...p }: P) {
  return (
    <svg {...base24} width={width} height={height} {...p}>
      <rect x="3" y="5" width="14" height="14" rx="2" />
      <path d="M17 10l4-2v8l-4-2z" />
      <path d="M8 10l4 2-4 2z" />
    </svg>
  );
}

/** icons/p3-ppt.svg — PPT 구성·템플릿 아이콘 */
export function P3PptIcon({ width = 24, height = 24, ...p }: P) {
  return (
    <svg {...base24} width={width} height={height} {...p}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M12 16v4M8 20h8M7 9h6M7 12h4" />
    </svg>
  );
}

/** icons/p3-qa.svg — 결과물 검수 체크리스트 아이콘 */
export function P3QaIcon({ width = 24, height = 24, ...p }: P) {
  return (
    <svg {...base24} width={width} height={height} {...p}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 10l2 2 5-5M8 16h8" />
    </svg>
  );
}

/** icons/p3-bundle.svg — 납품 묶음 아이콘 */
export function P3BundleIcon({ width = 24, height = 24, ...p }: P) {
  return (
    <svg {...base24} width={width} height={height} {...p}>
      <path d="M4 8l8-4 8 4-8 4-8-4z" />
      <path d="M4 12l8 4 8-4M4 16l8 4 8-4" />
    </svg>
  );
}

/** empty/empty-execution.svg — 아직 실행(생성)된 것이 없음을 나타내는 그림(P3-g 납품 묶음 빈 상태, ASSETS-HANDOFF 5절) */
export function EmptyExecutionArt({ width = 96, height = 72, ...p }: P) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 96 72"
      width={width}
      height={height}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
      {...p}
    >
      <circle cx="48" cy="36" r="22" strokeOpacity="0.45" />
      <path d="M42 27l16 9-16 9V27z" fill="currentColor" fillOpacity="0.14" />
    </svg>
  );
}

/** empty/empty-brief.svg — 아직 작성된 문서가 없음을 나타내는 문서 그림(P3-a·b·d·e·f 빈 상태, ASSETS-HANDOFF 4절) */
export function EmptyBriefArt({ width = 96, height = 72, ...p }: P) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 96 72"
      width={width}
      height={height}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
      {...p}
    >
      <rect x="24" y="10" width="48" height="52" rx="6" strokeOpacity="0.45" />
      <path d="M34 24h28M34 34h20M34 44h14" strokeOpacity="0.7" />
      <circle cx="66" cy="50" r="10" fill="currentColor" fillOpacity="0.12" />
      <path d="M66 46v8M62 50h8" />
    </svg>
  );
}

/** empty/empty-assets.svg — 등록된 디자인 자산이 없음을 나타내는 이미지 프레임 그림 */
export function EmptyAssetsArt({ width = 96, height = 72, ...p }: P) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 96 72"
      width={width}
      height={height}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
      {...p}
    >
      <rect x="16" y="14" width="64" height="44" rx="6" strokeOpacity="0.45" />
      <circle cx="34" cy="30" r="5" strokeOpacity="0.75" />
      <path d="M20 50l16-14 12 10 10-8 18 12" strokeOpacity="0.75" />
    </svg>
  );
}

/** badges/badge-drafting.svg — 작성 중 */
export function BadgeDrafting({ width = 16, height = 16, ...p }: P) {
  return (
    <svg {...base24} width={width} height={height} {...p}>
      <circle cx="12" cy="12" r="8" />
      <path d="M9 12h6" />
    </svg>
  );
}

/** badges/badge-ready.svg — 확정·검토 완료·승인 */
export function BadgeReady({ width = 16, height = 16, ...p }: P) {
  return (
    <svg {...base24} width={width} height={height} {...p}>
      <circle cx="12" cy="12" r="8" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </svg>
  );
}

/** badges/badge-archived.svg — 보관 */
export function BadgeArchived({ width = 16, height = 16, ...p }: P) {
  return (
    <svg {...base24} width={width} height={height} {...p}>
      <rect x="4" y="6" width="16" height="4" rx="1" />
      <path d="M6 10v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8M10 14h4" />
    </svg>
  );
}

/** badges/badge-stale.svg — 이전 기준 경고 */
export function BadgeStale({ width = 16, height = 16, ...p }: P) {
  return (
    <svg {...base24} width={width} height={height} {...p}>
      <path d="M12 4l9 16H3L12 4z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  );
}

/** badges/badge-blocked.svg — 차단·불일치 */
export function BadgeBlocked({ width = 16, height = 16, ...p }: P) {
  return (
    <svg {...base24} width={width} height={height} {...p}>
      <circle cx="12" cy="12" r="8" />
      <path d="M7.5 7.5l9 9" />
    </svg>
  );
}
