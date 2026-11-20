import { NextResponse } from "next/server";
import { z } from "zod";
import { bundleLabel } from "@/domain/qa-delivery";
import { getDeliveryManifestInput } from "@/features/qa-delivery/manifest";
import { buildDeliveryManifest } from "@/server/export/delivery-md";
import { attachmentHeader } from "@/server/export/text";

/**
 * P3FG-BACKEND-IMPL-01: 납품 목록 .md 내려받기 GET /delivery-bundles/[bundleId]/manifest.
 * 읽기만(RLS). 남의 것·없는 id 는 같은 404. 보관한 묶음·보관한 프로젝트도 된다(조회·내려받기 허용). 외부 발송 없음.
 */
const NOT_FOUND = () => new NextResponse("찾을 수 없습니다.", { status: 404, headers: { "Cache-Control": "private, no-store", "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(_request: Request, ctx: RouteContext<"/delivery-bundles/[bundleId]/manifest">) {
  const { bundleId } = await ctx.params;
  if (!z.uuid().safeParse(bundleId).success) return NOT_FOUND();
  const input = await getDeliveryManifestInput(bundleId);
  if (!input) return NOT_FOUND();
  const label = bundleLabel(input.bundleNo);
  return new NextResponse(buildDeliveryManifest(input), {
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": attachmentHeader(`납품묶음-${label}.md`, `delivery-${label}.md`),
    },
  });
}
