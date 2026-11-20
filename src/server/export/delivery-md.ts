import { bundleLabel } from "@/domain/qa-delivery";
import { kstMinute, mdText } from "./text";

/**
 * P3FG-BACKEND-IMPL-01: 납품 목록 .md(Master ⑤ — 1차는 목록 + 항목별 기존 내려받기 링크, 한 zip 없음). 순수 함수.
 * 사용자 글(산출물 이름·전달 메모)은 mdText 로만. 링크는 앱 안 경로(상대 주소)만 — 외부 주소·서명 URL 은 넣지 않는다(만료되므로).
 */
export interface DeliveryManifestInput {
  bundleNo: number;
  status: "drafting" | "reviewed";
  archived: boolean;
  createdAt: Date;
  restoredFromNo: number | null;
  items: Array<{ kind: string; title: string; versionNo: number; qaRoundNo: number | null; approvedAt: Date | null; link: string | null; sha256: string }>;
  logs: Array<{ method: string; deliveredAt: Date; note: string | null }>;
  exportedAt: Date;
}
const KIND: Record<string, string> = { production_brief: "공통 제작 브리프", web_copy: "홈페이지", design_assets: "디자인 자산", video_plan: "영상", ppt_deck: "PPT" };
const METHOD: Record<string, string> = { email: "이메일 직접 발송", cloud_link: "클라우드 링크 공유", messenger: "메신저 파일 전달", in_person: "직접 전달" };

export function buildDeliveryManifest(m: DeliveryManifestInput): string {
  const out = [
    `# 납품 묶음 ${bundleLabel(m.bundleNo)}`,
    "",
    `- 상태: ${m.status === "reviewed" ? "검토 완료" : "작성 중"}${m.archived ? " · 보관" : ""} · 항목: ${m.items.length}건 · 만든 시각: ${kstMinute(m.createdAt)} (KST)`,
    ...(m.restoredFromNo ? [`- 복구 원본: ${bundleLabel(m.restoredFromNo)}`] : []),
    `- 내보낸 시각: ${kstMinute(m.exportedAt)} (KST)`,
    "",
    "## 포함 항목",
    "",
    "| # | 종류 | 이름 | 판 | 검수 | 승인 시각 | 내려받기 |",
    "|---|---|---|---|---|---|---|",
    ...m.items.map((x, i) =>
      `| ${i + 1} | ${KIND[x.kind] ?? x.kind} | ${mdText(x.title)} | v${x.versionNo} | ${x.qaRoundNo ? `${x.qaRoundNo}회차 통과` : "검수 대상 아님"} | ${x.approvedAt ? kstMinute(x.approvedAt) : "-"} | ${x.link ? `[열기](${x.link})` : "-"} |`,
    ),
    "",
    "## 고객 전달 기록",
    "",
    ...(m.logs.length ? m.logs.map((l) => `- ${kstMinute(l.deliveredAt)} (KST) · ${METHOD[l.method] ?? l.method}${l.note ? ` · ${mdText(l.note)}` : ""}`) : ["- 아직 기록이 없습니다."]),
    "",
    "## 확인값(sha256)",
    "",
    ...m.items.map((x, i) => `- ${i + 1}. \`${x.sha256}\``),
    "",
    "---",
    `기준 묶음: ${bundleLabel(m.bundleNo)} · 총 ${m.items.length}건 · 내보낸 시각: ${kstMinute(m.exportedAt)} (KST)`,
    "",
  ];
  return out.join("\n");
}
