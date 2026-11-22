import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * 1차 거름 (Next.js proxy). 할 일은 두 가지뿐이다.
 * 1) Supabase 세션 쿠키를 갱신해 응답에 실어 보낸다.
 * 2) 로그인 안 된 요청을 로그인 화면으로 보낸다.
 * 허용 이메일 확인·데이터 권한은 서버의 src/server/auth/session.ts 와 DB RLS가 다시 확인한다.
 */

// 로그인 없이 열 수 있는 화면. /reset-password 는 재설정 메일 링크로 로그인된 뒤에만 연다.
// 루트 경로("/")는 공개 메인이며 업무실 현황("/workspace")과 관리자 화면("/admin")은 로그인이 필요하다.
const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/auth/"];

function isPublic(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PATHS.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p));
}

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return new NextResponse("Supabase 설정이 없습니다 (.env.local 확인).", { status: 500 });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });

  // 세션 갱신. 이 호출과 응답 반환 사이에 다른 코드를 넣지 않는다.
  const { data } = await supabase.auth.getClaims();
  const loggedIn = Boolean(data?.claims?.sub);

  if (!loggedIn && !isPublic(request.nextUrl.pathname)) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    const redirect = NextResponse.redirect(login);
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
