/**
 * 서명 URL 의 내려받기 파일 이름 바로잡기(P3C-BACKEND-IMPL-01, PG 17 전용 스택 실측).
 * supabase-js createSignedUrl(…, { download: "로고.svg" }) 는 이름을 두 번 인코딩해(download=%25EB…),
 * 저장소가 Content-Disposition filename*=UTF-8''%25EB… 를 돌려준다 → 브라우저가 "%EB%A1%9C….svg" 로 저장한다.
 * 그래서 download=true 로 서명한 뒤 download 값만 encodeURIComponent 한 번으로 바꾼다(서명 토큰은 download 값을 담지 않는다).
 * 결과: attachment; filename*=UTF-8''%EB%A1%9C%EA%B3%A0.svg (RFC 5987, 한글 이름 그대로 저장)
 */
export function withDownloadName(signedUrl: string, fileName: string): string {
  const u = new URL(signedUrl);
  u.searchParams.delete("download");
  const sep = u.search ? "&" : "?";
  return `${u.toString()}${sep}download=${encodeURIComponent(fileName)}`;
}
