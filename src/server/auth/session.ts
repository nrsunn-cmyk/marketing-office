import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { allowedEmailsFromEnv, isAllowedEmail } from "./allowlist";

/**
 * 인증 확인 계층 (Next.js 권장 Data Access Layer).
 * proxy 의 검사는 빠른 1차 거름일 뿐이고, 데이터를 읽거나 쓰는 모든 서버 코드는 이 함수를 거친다.
 */

export interface SessionUser {
  userId: string;
  email: string;
}

/** JWT를 검증해 로그인 사용자를 돌려준다. 없거나 허용되지 않은 계정이면 null. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // 로그인 확인은 항상 요청 시점에 한다(만료 시각 비교 때문에 미리 렌더링할 수 없다)
  await connection();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  const email = typeof claims.email === "string" ? claims.email : null;
  if (!isAllowedEmail(email, allowedEmailsFromEnv())) return null;
  return { userId: claims.sub, email: email as string };
});

/** 로그인하지 않았거나 허용되지 않은 계정이면 로그인 화면으로 보낸다. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export interface Workspace {
  id: string;
  name: string;
  timezone: string;
}

export const getWorkspace = cache(async (): Promise<Workspace | null> => {
  await requireUser();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("workspaces").select("id, name, timezone").maybeSingle();
  if (error) throw new Error(`업무실을 불러오지 못했습니다: ${error.message}`);
  return data;
});

/** 업무실이 아직 없으면 처음 설정 화면으로 보낸다. */
export async function requireWorkspace(): Promise<{ user: SessionUser; workspace: Workspace }> {
  const user = await requireUser();
  const workspace = await getWorkspace();
  if (!workspace) redirect("/setup");
  return { user, workspace };
}
