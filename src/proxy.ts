import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * 1차 거름 (Next.js proxy). 할 일은 세 가지뿐이다.
 * 1) Supabase 세션 쿠키를 갱신해 응답에 실어 보낸다.
 * 2) 로그인 안 된 요청을 로그인 화면으로 보낸다.
 * 3) 관리자 화면(/admin, /admin/…)은 관리자가 아니면 404 로 돌려준다(ADMIN-404-01).
 *    이 앱은 cacheComponents 라 페이지 안 notFound() 는 미리 그린 껍데기가 먼저 200 으로 나간 뒤라 상태 코드를 바꿀 수 없다
 *    (Front APP-404-STATUS-01). 요청 시점 404 는 Proxy 에서만 낼 수 있다. 페이지 안 requireAdminOr404() 는 두 번째 거름으로 그대로 둔다.
 * 허용 이메일 확인·데이터 권한은 서버의 src/server/auth/session.ts 와 DB RLS가 다시 확인한다.
 */

// 로그인 없이 열 수 있는 화면. /reset-password 는 재설정 메일 링크로 로그인된 뒤에만 연다.
// 루트 경로("/")는 비로그인 방문자에게 공식 웹 메인 랜딩 페이지를 제공하므로 공개 허용한다.
const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/auth/"];

function isPublic(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PATHS.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p));
}

/** 관리자 화면 경로(/admin 또는 /admin/…). /administrator 같은 다른 경로는 아니다 */
function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

/** 관리자가 아니거나 확인에 실패했을 때의 404. 갱신된 세션 쿠키는 그대로 싣는다. 본문은 관리자 흔적 없는 짧은 글 */
function notFoundResponse(from: NextResponse): NextResponse {
  const res = new NextResponse("찾을 수 없습니다.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow" },
  });
  for (const c of from.cookies.getAll()) res.cookies.set(c);
  return res;
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
  // 관리자 화면만 요청 시점에 관리자 여부를 확인한다(이 경로에만 RPC 1번). 확인 오류도 404(관리자 화면을 보여 주지 않는 쪽으로)
  if (loggedIn && isAdminPath(request.nextUrl.pathname)) {
    const { data: isAdmin, error } = await supabase.rpc("admin_whoami");
    if (error || isAdmin !== true) return notFoundResponse(response);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
