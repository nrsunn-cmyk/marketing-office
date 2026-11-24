"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { ActionForm } from "../../../_components/action-form";
import type { FormState } from "../../../_components/form-state";
import styles from "../../../ui.module.css";
import { EXEC_ACTION_COPY } from "@/features/execution/copy";

/**
 * P4-ALERT-FRONT-01: 실행 대기열 막힘 경고를 폼 밖(대기열 머리) live 영역에 한 번 알린다(AGY P4-ALERT-DESIGN-01, Tester QA-P4-SIGNED-INTEGRATION-01 F1).
 *
 * 막힘(blocked_mismatch)이 저장되면 화면이 새로 고쳐지고 그 폼(게시 기록·승인)이 사라져 폼 안 안내(role=status)가 남지 못했다.
 * - 대기열 동작이 tone 'warn' 으로 끝나면 → 대기열 머리 영역에 그 안내를 한 번 띄운다(폼 안에는 다시 그리지 않아 두 번 읽지 않는다)
 * - 다음 대기열 동작을 시작하면 비운다. 새로 고침(F5)·첫 진입에는 상태가 없으므로 비어 있다(지난 막힘은 카드의 role=note 로만)
 * - 다른 구역 조작으로 화면이 다시 그려져도 글이 그대로면 화면 읽기 프로그램이 다시 읽지 않는다
 */
export const QUEUE_ALERT_COPY = {
  /** content_changed 막힘(AGY P4-ALERT-DESIGN-01 2절 라) */
  contentChanged: "승인 이후 원본 초안 내용이 바뀌어 게시가 자동 보류되었습니다. 아래 카드에서 내용을 확인하고 다시 승인해 주세요.",
} as const;

/** 서버 안내 → 대기열 머리 문구(내용 변경 막힘은 AGY 확정 문장, 그 밖 보호 차단은 서버 문구 그대로) */
export function queueAlertText(message: string): string {
  return message === EXEC_ACTION_COPY.blockedContentChanged ? QUEUE_ALERT_COPY.contentChanged : message;
}

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;
interface QueueAlertApi {
  announce: (text: string) => void;
  clear: () => void;
}
const QueueAlertContext = createContext<QueueAlertApi | null>(null);

/**
 * 대기열 동작 결과 처리: 막힘(tone warn)이면 대기열 머리에 알리고 폼에는 안내·톤을 빼고 돌려준다(두 번 읽힘 방지).
 * 그 밖(성공·오류)은 그대로 폼이 그린다.
 */
export function routeQueueResult(r: FormState, alert: Pick<QueueAlertApi, "announce">): FormState {
  if (r.tone !== "warn" || !r.message) return r;
  alert.announce(queueAlertText(r.message));
  return { ok: r.ok, errors: r.errors };
}

/** 대기열 머리 live 영역 + 그 아래 대기열 내용. 영역은 늘 두고 글만 바꾼다 */
export function QueueAlert({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; n: number } | null>(null);
  const api = useMemo<QueueAlertApi>(
    () => ({
      announce: (text) => setMsg((m) => ({ text, n: (m?.n ?? 0) + 1 })),
      clear: () => setMsg(null),
    }),
    [],
  );
  return (
    <QueueAlertContext.Provider value={api}>
      <div role="status" aria-live="polite" aria-atomic="true" data-queue-alert="">
        {msg && (
          <p key={msg.n} className={styles.warnNotice}>
            {msg.text}
          </p>
        )}
      </div>
      {children}
    </QueueAlertContext.Provider>
  );
}

/** 대기열 폼: ActionForm 그대로 + 막힘 결과를 대기열 머리로 보낸다(영역 밖에서 쓰면 ActionForm 과 같다) */
export function QueueActionForm({ action, ...rest }: ComponentProps<typeof ActionForm>) {
  const alert = useContext(QueueAlertContext);
  const wrapped = useCallback<Action>(
    async (prev, fd) => {
      alert?.clear();
      return alert ? routeQueueResult(await action(prev, fd), alert) : action(prev, fd);
    },
    [action, alert],
  );
  return <ActionForm action={alert ? wrapped : action} {...rest} />;
}
