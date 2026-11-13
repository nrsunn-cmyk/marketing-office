import { NextResponse } from "next/server";
import { siteUrl } from "@/server/env";
import { createSupabaseServerClient } from "@/server/supabase/server";

/** 로그아웃. 링크로 실수로 로그아웃되지 않도록 POST만 받는다. */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", siteUrl()), { status: 303 });
}
