import { NextResponse } from "next/server";
import { z } from "zod";
import { renderQuotePdf } from "@/features/quotes/pdf";
import { getQuoteDocument } from "@/features/quotes/server";

/**
 * 확정 견적서 PDF. DB에 고정된 견적 버전에서 그때그때 만든다.
 * 같은 버전이면 언제 다시 받아도 같은 내용이다(T11). 실패해도 견적 본문은 바뀌지 않는다.
 */
export async function GET(_request: Request, ctx: RouteContext<"/quote-versions/[quoteVersionId]/pdf">) {
  const { quoteVersionId } = await ctx.params;
  if (!z.uuid().safeParse(quoteVersionId).success) return new NextResponse("찾을 수 없습니다.", { status: 404 });
  const doc = await getQuoteDocument(quoteVersionId);
  if (!doc) return new NextResponse("찾을 수 없습니다.", { status: 404 });
  try {
    const pdf = await renderQuotePdf(doc);
    const fileName = `견적서-${doc.quoteNumber}.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="quote-${doc.quoteNumber}.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("[quote pdf] 생성 실패:", (e as Error).message);
    return new NextResponse("PDF를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.", { status: 500 });
  }
}
