import type { Metadata } from "next";

/**
 * 검색 노출 A안 2단계(NADAUM-BRAND-INDEX-FLAG-01): 켜면 공개 첫 화면(/)만 index·follow,
 * 끄면 아무것도 넣지 않아 루트 layout 의 noindex 를 그대로 따른다.
 */
export function brandRobots(indexable: boolean): Pick<Metadata, "robots"> {
  return indexable ? { robots: { index: true, follow: true } } : {};
}
