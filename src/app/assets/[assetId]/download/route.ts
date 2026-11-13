import { NextResponse } from "next/server";
import { z } from "zod";
import { getAssetDownloadUrl } from "@/features/assets/server";

/** 본인 파일만 1분짜리 서명 주소로 보내 준다. 저장소 주소를 화면에 그대로 노출하지 않는다. */
export async function GET(_request: Request, ctx: RouteContext<"/assets/[assetId]/download">) {
  const { assetId } = await ctx.params;
  if (!z.uuid().safeParse(assetId).success) return new NextResponse("찾을 수 없습니다.", { status: 404 });
  const r = await getAssetDownloadUrl(assetId);
  if (!r.ok) return new NextResponse(r.message, { status: 404 });
  return NextResponse.redirect(r.data.url, { status: 303 });
}
