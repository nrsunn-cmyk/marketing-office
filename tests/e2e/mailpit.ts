/**
 * 시험 스택의 Mailpit(가짜 메일함)에서 메일을 읽는다. 시험 전용.
 *
 * MAIL-SAFETY-01
 * - 기본 주소가 없다. 시험이 쓰는 함수(아래 deleteMessagesTo·countMessagesTo·waitForMail·waitForMailLink)는
 *   부를 때마다 stack-guard.preflight()(환경·설정·실제 컨테이너 대조)를 먼저 통과해야 하며,
 *   맞지 않으면 네트워크 요청을 하나도 보내지 않고 실패한다.
 * - 메일함 전체 삭제는 하지 않는다. 받는 사람이 정확히 그 주소 하나뿐인 메시지만 ID 로 골라 지운다.
 *   여러 사람에게 간 메일은 남긴다. ID 가 비었거나 형식이 이상하면 지우지 않는다.
 *   (Mailpit 은 DELETE /messages 에 ID 목록이 비면 전체를 지우므로, 지울 ID 가 없으면 DELETE 를 보내지 않는다.)
 */
import { preflight } from "./stack-guard";

interface MessageSummary {
  ID: string;
  Created: string;
  Subject: string;
  To: Array<{ Address: string }>;
}

type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ json(): Promise<unknown>; ok: boolean; status: number }>;

const EMAIL = /^[^\s"'\\@<>(),;:]+@[^\s"'\\@<>(),;:]+\.[^\s"'\\@<>(),;:]+$/;
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function assertEmail(email: string): string {
  if (!EMAIL.test(email)) throw new Error(`시험 메일 주소 형식이 아닙니다(검색어 탈출 방지): ${JSON.stringify(email)}`);
  return email.toLowerCase();
}

const toList = (m: MessageSummary) => (Array.isArray(m.To) ? m.To.map((t) => String(t?.Address ?? "").toLowerCase()) : []);

/**
 * [단위 시험 전용 경계] 이미 확인된 주소(base)와 fetch 로 메일함 함수를 만든다.
 * 이 함수를 직접 부르면 preflight 를 거치지 않으므로, 시험 코드(spec)는 쓰지 말고 아래 가드 함수만 쓴다.
 */
export function createMailpitForUnitTest(base: string, fetchImpl: FetchLike) {
  /** 검색 결과를 받는 사람 주소로 다시 정확히 거른다(Mailpit 검색은 부분 일치일 수 있다). */
  async function search(email: string): Promise<MessageSummary[]> {
    const addr = assertEmail(email);
    const r = await fetchImpl(`${base}/search?query=${encodeURIComponent(`to:"${addr}"`)}`);
    const body = (await r.json()) as { messages?: MessageSummary[] };
    return (body.messages ?? []).filter((m) => toList(m).includes(addr));
  }

  /** 받는 사람이 정확히 그 주소 하나인 메시지만 지운다. 지울 것이 없으면 DELETE 를 보내지 않는다. */
  async function deleteMessagesTo(emails: string[]): Promise<number> {
    if (emails.length === 0) throw new Error("지울 수신자가 없습니다(전체 삭제는 하지 않습니다).");
    const addrs = emails.map(assertEmail);
    const ids = new Set<string>();
    for (const addr of addrs) {
      for (const m of await search(addr)) {
        const to = toList(m);
        if (to.length === 1 && to[0] === addr && MESSAGE_ID.test(String(m.ID))) ids.add(m.ID);
      }
    }
    if (ids.size === 0) return 0;
    const r = await fetchImpl(`${base}/messages`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ IDs: [...ids] }),
    });
    if (!r.ok) throw new Error(`메일 정리 실패(HTTP ${r.status})`);
    return ids.size;
  }

  async function countMessagesTo(email: string): Promise<number> {
    return (await search(email)).length;
  }

  /** 해당 주소로 온 가장 최근 메일(제목·본문). 올 때까지 잠시 기다린다. */
  async function waitForMail(email: string, timeoutMs = 15_000): Promise<{ subject: string; html: string }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const messages = (await search(email)).filter((m) => MESSAGE_ID.test(String(m.ID)));
      if (messages.length > 0) {
        const latest = messages.sort((a, b) => b.Created.localeCompare(a.Created))[0]!;
        const msg = (await (await fetchImpl(`${base}/message/${latest.ID}`)).json()) as { HTML: string; Text: string };
        return { subject: latest.Subject, html: msg.HTML || msg.Text };
      }
      await new Promise((res) => setTimeout(res, 300));
    }
    throw new Error(`${email} 로 메일이 오지 않았습니다`);
  }

  /** 가장 최근 메일 안의 인증 링크(우리 양식: /auth/callback?token_hash=… / 기본 양식: /auth/v1/verify…) */
  async function waitForMailLink(email: string, timeoutMs = 15_000): Promise<string> {
    const { html } = await waitForMail(email, timeoutMs);
    const m = /https?:\/\/[^\s"'<>)]+\/auth\/(?:callback\?token_hash|v1\/verify)[^\s"'<>)]+/.exec(html);
    if (!m) throw new Error(`${email} 메일에 인증 링크가 없습니다`);
    return m[0].replace(/&amp;/g, "&");
  }

  return { deleteMessagesTo, countMessagesTo, waitForMail, waitForMailLink };
}

/** 부를 때마다 preflight(환경·설정·컨테이너)를 먼저 통과시킨다. 틀리면 fetch 전에 예외. */
function guarded() {
  const { mailpitBase } = preflight();
  return createMailpitForUnitTest(mailpitBase, fetch as unknown as FetchLike);
}

export const deleteMessagesTo = (emails: string[]) => guarded().deleteMessagesTo(emails);
export const countMessagesTo = (email: string) => guarded().countMessagesTo(email);
export const waitForMail = (email: string, timeoutMs?: number) => guarded().waitForMail(email, timeoutMs);
export const waitForMailLink = (email: string, timeoutMs?: number) => guarded().waitForMailLink(email, timeoutMs);
