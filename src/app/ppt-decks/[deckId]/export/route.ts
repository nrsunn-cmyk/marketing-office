import { NextResponse } from "next/server";
import { z } from "zod";
import { getPptExportInput } from "@/features/ppt-decks/server";
import { buildDeckMarkdown } from "@/server/export/md";
import { buildPptx, PPTX_MIME } from "@/server/export/pptx";
import { attachmentHeader, safeDownloadName } from "@/server/export/text";

/**
 * P3E-BACKEND-IMPL-01: PPT 구성안 내보내기 GET /ppt-decks/[deckId]/export?format=pptx|md&version=<n>(생략하면 현재 판).
 * - 읽기만: 로그인 사용자 토큰 + RLS 로 본인 업무실 구성안만. 남의 것·없는 id·없는 판은 같은 404(존재를 알려 주지 않음).
 * - 보관한 구성안·읽기 전용 프로젝트도 내보낼 수 있다(AGY 인계 3-2). 쓰기·서명·감사 없음.
 * - 요청 때마다 바로 만들어 내려준다(서버 저장 없음). 새 의존성 0(D1 A안), 이미지 없음(D2).
 */
const NOT_FOUND = () => new NextResponse("찾을 수 없습니다.", { status: 404, headers: { "Cache-Control": "private, no-store", "Content-Type": "text/plain; charset=utf-8" } });
const query = z.object({
  format: z.enum(["pptx", "md"]),
  version: z.coerce.number().int().min(1).max(20).optional(),
});

export async function GET(request: Request, ctx: RouteContext<"/ppt-decks/[deckId]/export">) {
  const { deckId } = await ctx.params;
  if (!z.uuid().safeParse(deckId).success) return NOT_FOUND();
  const sp = new URL(request.url).searchParams;
  const q = query.safeParse({ format: sp.get("format") ?? undefined, version: sp.get("version") ?? undefined });
  if (!q.success) return NOT_FOUND();
  const input = await getPptExportInput(deckId, q.data.version ?? null);
  if (!input) return NOT_FOUND();
  try {
    const base = `${safeDownloadName(input.title, "PPT-구성안")}-v${input.versionNo}`;
    const common = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
    if (q.data.format === "md") {
      return new NextResponse(buildDeckMarkdown(input), {
        headers: { ...common, "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": attachmentHeader(`${base}.md`, `ppt-deck-v${input.versionNo}.md`) },
      });
    }
    const bytes = buildPptx(input);
    return new NextResponse(new Uint8Array(bytes), {
      headers: { ...common, "Content-Type": PPTX_MIME, "Content-Disposition": attachmentHeader(`${base}.pptx`, `ppt-deck-v${input.versionNo}.pptx`) },
    });
  } catch (e) {
    console.error("[ppt export] 생성 실패:", (e as Error).message);
    return new NextResponse("내보내기 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.", { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
