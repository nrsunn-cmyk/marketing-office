import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabasePublicEnv } from "@/server/env";

/**
 * 요청마다 새로 만드는 서버용 Supabase 클라이언트.
 * 로그인한 사용자 권한으로만 DB에 접속하므로 RLS가 적용된다 (C05: service role 사용 금지).
 */
export async function createSupabaseServerClient() {
  const { url, publishableKey } = supabasePublicEnv();
  const cookieStore = await cookies();
  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // 서버 컴포넌트 렌더 중에는 쿠키를 쓸 수 없다. 세션 갱신은 proxy 가 맡는다.
        }
      },
    },
  });
}
