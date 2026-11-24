import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

/** P4-ALERT-FRONT-01: 막힘 경고를 폼 밖 대기열 머리 live 영역에 한 번(실제 브라우저 확인은 Plan/…/P4-ALERT-FRONT-01/alert-browser.mjs) */
vi.mock("../../../_components/action-form", async () => {
  const { createElement: h } = await import("react");
  return { ActionForm: ({ submitLabel, children }: { submitLabel: string; children?: unknown }) => h("form", null, children as never, h("button", { type: "submit" }, submitLabel)) };
});
vi.mock("../../../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

const { QUEUE_ALERT_COPY, QueueAlert, QueueActionForm, queueAlertText, routeQueueResult } = await import("./queue-alert");
const { EXEC_ACTION_COPY } = await import("@/features/execution/copy");

describe("대기열 막힘 알림", () => {
  it("막힘(tone warn)만 대기열 머리로 보내고, 폼에는 안내·톤 없이 돌려준다(두 번 읽힘 방지)", () => {
    const announce = vi.fn();
    expect(routeQueueResult({ message: EXEC_ACTION_COPY.blockedContentChanged, tone: "warn" }, { announce })).toEqual({ ok: undefined, errors: undefined });
    expect(announce).toHaveBeenCalledOnce();
    expect(announce).toHaveBeenCalledWith(QUEUE_ALERT_COPY.contentChanged);
  });

  it("성공·이미 끝남·서버 오류·칸 오류는 그대로 폼이 그린다(알림 없음)", () => {
    const announce = vi.fn();
    for (const r of [{ ok: true }, { ok: true, message: EXEC_ACTION_COPY.alreadyDoneNotice }, { message: "이미 끝난 실행 건은 다시 할 수 없습니다." }, { errors: { url: "주소를 확인해 주세요." } }]) {
      expect(routeQueueResult(r, { announce })).toBe(r);
    }
    expect(routeQueueResult({ tone: "warn" }, { announce })).toEqual({ tone: "warn" });
    expect(announce).not.toHaveBeenCalled();
  });

  it("문구: 내용 변경 막힘은 AGY 확정 문장, 그 밖 보호 차단은 서버 문구 그대로", () => {
    expect(queueAlertText(EXEC_ACTION_COPY.blockedContentChanged)).toBe("승인 이후 원본 초안 내용이 바뀌어 게시가 자동 보류되었습니다. 아래 카드에서 내용을 확인하고 다시 승인해 주세요.");
    expect(queueAlertText(EXEC_ACTION_COPY.blockedSourceArchived)).toBe(EXEC_ACTION_COPY.blockedSourceArchived);
  });

  it("영역은 늘 있고(role=status·polite·atomic) 처음엔 비어 있다 — 첫 진입·새로 고침에 지난 막힘을 다시 읽지 않음", () => {
    const h = renderToString(createElement(QueueAlert, null, createElement(QueueActionForm, { action: async () => ({}), submitLabel: "게시 완료 기록" })));
    expect(h).toMatch(/^<div role="status" aria-live="polite" aria-atomic="true" data-queue-alert=""><\/div><form>/);
    expect(h).not.toContain("warnNotice");
  });
});
