import "server-only";

/**
 * 앱의 공식 주소. 로그인 후 이동 주소는 반드시 이 값으로 만든다.
 * 요청에서 읽은 주소(개발 서버는 localhost로 바꿔 알려 준다)를 쓰면 127.0.0.1 쿠키가 따라오지 않는다.
 */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
}

/** 브라우저에도 공개되는 Supabase 접속 정보. 비밀 키(service role)는 여기서 다루지 않는다 (C05). */
export function supabasePublicEnv(): { url: string; publishableKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 가 없습니다. .env.example 을 .env.local 로 복사해 채워 주세요.",
    );
  }
  return { url, publishableKey };
}
