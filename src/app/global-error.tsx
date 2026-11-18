"use client"; // 오류 경계는 클라이언트 컴포넌트여야 한다

/**
 * 최상위 안전망 (UI-RESP-04, QA-SWEEP-01 D1): 루트 레이아웃까지 실패했을 때 쓰인다.
 * 이때는 앱 CSS·글꼴·테마가 붙지 않으므로 html·body 와 최소 스타일을 직접 둔다(밝음/어두움은 OS 설정을 따른다).
 * 문구는 목록 화면(UI-RESP-03)의 오류 문구 규칙과 같다. 서버 오류 내용은 보여 주지 않는다.
 */
const CSS = `
:root { color-scheme: light dark; --bg: #f8fafc; --card: #ffffff; --text: #0f172a; --muted: #475569; --err-bg: #fef2f2; --err-border: #fecaca; --err-text: #b91c1c; --btn: #1d4ed8; --btn-text: #ffffff; --border: #cbd5e1; }
@media (prefers-color-scheme: dark) { :root { --bg: #0b1120; --card: #111827; --text: #e5e7eb; --muted: #94a3b8; --err-bg: #3b0d0d; --err-border: #7f1d1d; --err-text: #fecaca; --btn: #3b82f6; --btn-text: #0b1120; --border: #334155; } }
body { margin: 0; background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif; }
main { max-width: 560px; margin: 0 auto; padding: 48px 16px; }
h1 { font-size: 22px; margin: 0 0 16px; word-break: keep-all; }
.box { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
.alert { margin: 0 0 16px; padding: 12px 16px; border-radius: 10px; background: var(--err-bg); border: 1px solid var(--err-border); color: var(--err-text); word-break: keep-all; }
.row { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; }
button, a.btn { min-height: 44px; padding: 10px 18px; border-radius: 10px; font: inherit; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; text-decoration: none; }
button { border: 0; background: var(--btn); color: var(--btn-text); }
a.btn { border: 1px solid var(--border); background: transparent; color: var(--text); }
`;

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  console.error("[global-error]", error);
  return (
    <html lang="ko">
      <body>
        <title>오류 · 마케팅 업무실</title>
        <style>{CSS}</style>
        <main>
          <h1>화면을 불러오지 못했습니다</h1>
          <div className="box">
            <p className="alert" role="alert">
              화면을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
            </p>
            <p className="row">
              <button type="button" onClick={() => retry()}>
                다시 불러오기
              </button>
              {/* 루트 레이아웃이 실패한 상태라 클라이언트 이동 대신 새로 불러온다 */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a className="btn" href="/">
                처음 화면으로
              </a>
            </p>
          </div>
        </main>
      </body>
    </html>
  );
}
