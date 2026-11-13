/** 로컬 Supabase에 들어 있는 Mailpit(가짜 메일함)에서 로그인 메일을 읽는다. 테스트 전용. */
const MAILPIT = "http://127.0.0.1:54324/api/v1";

interface MessageSummary {
  ID: string;
  Created: string;
  To: Array<{ Address: string }>;
}

export async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT}/messages`, { method: "DELETE" });
}

export async function countMessagesTo(email: string): Promise<number> {
  const r = await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:"${email}"`)}`);
  const body = (await r.json()) as { messages: MessageSummary[] };
  return body.messages.length;
}

/** 해당 주소로 온 가장 최근 메일에서 로그인 링크를 꺼낸다. 메일이 올 때까지 잠시 기다린다. */
export async function waitForLoginLink(email: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const body = (await r.json()) as { messages: MessageSummary[] };
    if (body.messages.length > 0) {
      const latest = body.messages.sort((a, b) => b.Created.localeCompare(a.Created))[0];
      const msg = (await (await fetch(`${MAILPIT}/message/${latest.ID}`)).json()) as { HTML: string; Text: string };
      const m = /https?:\/\/[^\s"'<>)]+\/auth\/v1\/verify[^\s"'<>)]+/.exec(msg.HTML || msg.Text);
      if (m) return m[0].replace(/&amp;/g, "&");
    }
    await new Promise((res) => setTimeout(res, 300));
  }
  throw new Error(`${email} 로 로그인 메일이 오지 않았습니다`);
}
