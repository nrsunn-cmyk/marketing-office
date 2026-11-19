/**
 * 게시 주소 표(Tester QA-PLAN-P2G-01 R1-2). 앱(normalizePublicationUrl)·RPC(record_channel_publication)·CHECK 세 곳을 같은 표로 대조한다.
 * - app: 서버 액션이 정규화한 결과(거절이면 null). 한글 경로·한글 도메인·대문자 호스트는 정규화로 바뀐다.
 * - rpc: RPC 를 직접 불렀을 때 통과하는지(앞뒤 공백만 지우고 같은 식). CHECK 는 rpc 와 같은 식을 정리 없이 본다(check).
 *   정규화로 생긴 차이(한글·대문자)만 app 과 rpc 가 다를 수 있다.
 */
const long = (n: number) => `https://a.com/${"a".repeat(n - "https://a.com/".length)}`;

export interface UrlCase {
  raw: string;
  app: string | null;
  rpc: boolean;
  check: boolean;
}

export const PUBLICATION_URL_CASES: UrlCase[] = [
  // 통과
  { raw: "https://a.tistory.com/12", app: "https://a.tistory.com/12", rpc: true, check: true },
  { raw: "https://a0289.tistory.com/2028/20292", app: "https://a0289.tistory.com/2028/20292", rpc: true, check: true },
  { raw: "https://blog.example.co.kr/entry/한글?x=1#y", app: "https://blog.example.co.kr/entry/%ED%95%9C%EA%B8%80?x=1#y", rpc: false, check: false },
  { raw: "https://한글도메인.kr/1", app: "https://xn--bj0bj3i97fq8o5lq.kr/1", rpc: false, check: false },
  { raw: "https://A.TISTORY.COM/1", app: "https://a.tistory.com/1", rpc: true, check: true },
  { raw: "https://a.com:8443/x", app: "https://a.com:8443/x", rpc: true, check: true },
  { raw: "https://a.com", app: "https://a.com/", rpc: true, check: true },
  { raw: long(2048), app: long(2048), rpc: true, check: true },
  { raw: "https://evil-tistory.com/1", app: "https://evil-tistory.com/1", rpc: true, check: true },
  { raw: "https://tistory.com.evil.com/1", app: "https://tistory.com.evil.com/1", rpc: true, check: true },
  { raw: "  https://a.com/x \n", app: "https://a.com/x", rpc: true, check: false },
  { raw: 'https://a.com/"><script>', app: "https://a.com/%22%3E%3Cscript%3E", rpc: true, check: true },
  // 거절
  { raw: "http://a.com", app: null, rpc: false, check: false },
  { raw: "javascript:alert(1)", app: null, rpc: false, check: false },
  { raw: "JaVaScRiPt:alert(1)", app: null, rpc: false, check: false },
  { raw: "data:text/html,<script>alert(1)</script>", app: null, rpc: false, check: false },
  { raw: "vbscript:msgbox(1)", app: null, rpc: false, check: false },
  { raw: "file:///c:/x", app: null, rpc: false, check: false },
  { raw: "//a.com", app: null, rpc: false, check: false },
  { raw: "https://", app: null, rpc: false, check: false },
  { raw: "https:///a", app: null, rpc: false, check: false },
  { raw: "https:a.com", app: null, rpc: false, check: false },
  { raw: "https://a", app: null, rpc: false, check: false },
  { raw: "https://localhost", app: null, rpc: false, check: false },
  { raw: "https://a@b.com", app: null, rpc: false, check: false },
  { raw: "https://a:b@c.com/", app: null, rpc: false, check: false },
  { raw: "https://a.com x", app: null, rpc: false, check: false },
  // 역슬래시: URL 해석기는 / 로 바꿔 호스트가 a.com 으로 남는다(안전). RPC·CHECK 는 \ 를 받지 않는다
  { raw: "https://a.com\\@evil.com", app: "https://a.com/@evil.com", rpc: false, check: false },
  { raw: "\u0000https://a.com", app: null, rpc: false, check: false },
  { raw: "https://a.com/x\u0000", app: null, rpc: false, check: false },
  { raw: "\u200bhttps://a.com", app: null, rpc: false, check: false },
  { raw: "https://a.com/\u200b", app: null, rpc: false, check: false },
  { raw: "https://a.com/\u202eevil", app: null, rpc: false, check: false },
  { raw: "https://a.com/\u2028x", app: null, rpc: false, check: false },
  { raw: "https://a.com/\tb", app: null, rpc: false, check: false },
  { raw: "https://-a.com", app: null, rpc: false, check: false },
  { raw: "https://a-.com", app: null, rpc: false, check: false },
  { raw: "https://a..com", app: null, rpc: false, check: false },
  { raw: long(2049), app: null, rpc: false, check: false },
  { raw: "", app: null, rpc: false, check: false },
  { raw: "https://a.com\nhttps://b.com", app: null, rpc: false, check: false },
];
