import { PPT_STATUS_LABELS, pptTemplateOf } from "@/domain/ppt-decks";
import type { PptxInput } from "./pptx";
import { kstMinute, mdText } from "./text";

/**
 * P3E-BACKEND-IMPL-01: .md 구성안 내려받기(Tester Q14·E5, AGY P3E-TEMPLATES.md 3절). 순수 함수.
 * - 사용자 글은 mdText 로만(링크·이미지·HTML·표·강조가 생기지 않게, ES2). 요점은 줄마다 '- ', 메모는 줄마다 '> '
 * - UTF-8(BOM 없음)·LF. 자산은 이름·판 번호만(파일 주소 없음). 끝 줄에 기준 판·장 수·시각
 */
export function buildDeckMarkdown(input: PptxInput): string {
  const t = pptTemplateOf(input.templateKey);
  if (!t) throw new Error("알 수 없는 템플릿입니다");
  const when = kstMinute(input.exportedAt);
  const n = input.slides.length;
  const out: string[] = [
    `# ${mdText(input.title)}`,
    "",
    `- 템플릿: ${t.label} · 상태: ${PPT_STATUS_LABELS[input.status]} · 판: v${input.versionNo} · 슬라이드: ${n}장`,
    `- 내보낸 시각: ${when} (KST)`,
  ];
  input.slides.forEach((s, i) => {
    out.push("", `## ${i + 1}. ${mdText(s.title)}`);
    const bullets = (s.bullets ?? "").split(/\r\n?|\n/).filter((x) => x.trim() !== "");
    if (bullets.length) out.push("", ...bullets.map((x) => `- ${mdText(x.trim())}`));
    const notes = (s.notes ?? "").split(/\r\n?|\n/).filter((x) => x.trim() !== "");
    if (notes.length) out.push("", `> 발표자 메모: ${mdText(notes[0].trim())}`, ...notes.slice(1).map((x) => `> ${mdText(x.trim())}`));
    if (s.assets.length)
      out.push("", `사용 디자인 자산: ${s.assets.map((a) => `${mdText(input.assetNames.get(a.asset_id) ?? "알 수 없는 자산")} (v${a.version_no})`).join(", ")}`);
  });
  out.push("", "---", `기준 판: v${input.versionNo} · 총 ${n}장 · 내보낸 시각: ${when} (KST)`, "");
  return out.join("\n");
}
