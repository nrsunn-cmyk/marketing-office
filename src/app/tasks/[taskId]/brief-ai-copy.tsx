"use client";

import { startTransition, useActionState, useId, type FormEvent } from "react";
import { acceptBriefCopyAction, generateBriefCopyAction, type BriefCopyFormState } from "@/features/brief/actions";
import { ActionForm } from "../../_components/action-form";
import { HYDRATION_HINT_TEXT, useHydrationHint } from "../../_components/hydration-hint";
import { useHydrated } from "../../_components/use-hydrated";
import styles from "../../ui.module.css";
import a from "./brief-ai.module.css";

const EMPTY: BriefCopyFormState = {};

/**
 * 브리프 AI 문구 초안(DEC08-UI-01, 주인님 DEC-08 B, AGY 시안 BRIEF-AI-UI-01 의 6상태).
 * - 키가 없으면 이 부품을 그리지 않는다(부르는 쪽 brief-panel 이 isBriefCopyAiEnabled() 로 판단)
 * - 기본: 'AI 문구 생성' 단추와 전송 범위 안내 / 생성 중: 단추 끔 + 상태 안내 / 완료: 변형마다 '초안' 표시와 '이 초안 쓰기'
 * - 실패·한도: 서버가 준 한국어 문구(role=alert)와 '다시 시도'. 생성은 브리프를 바꾸지 않으므로 입력 내용은 그대로다
 * - 채택하면 서버가 카피 초안에 넣고 화면을 새로 그린다(이 부품은 부르는 쪽이 revision 으로 다시 만든다)
 * 전송 범위 안내는 서버 동작(DEC08-AI-COPY-01 '외부로 나가는 것')과 같게 쓴다. 시안 문구보다 넓다.
 */
export function BriefAiCopy({ taskId, briefId, revision }: { taskId: string; briefId: string; revision: number }) {
  const [state, formAction, pending] = useActionState(generateBriefCopyAction, EMPTY);
  const hydrated = useHydrated();
  const localWaitId = useId();
  const sharedHintId = useHydrationHint();
  const waitId = sharedHintId ?? localWaitId;
  const headingId = useId();
  const noteId = useId();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    startTransition(() => formAction(fd));
  }

  const failed = !pending && !state.ok && Boolean(state.message);
  const variants = !pending && state.ok ? (state.variants ?? []) : [];

  return (
    <section aria-labelledby={headingId} className={`${a.box} ${variants.length ? a.boxDraft : ""}`}>
      <h3 id={headingId} className={a.title}>
        AI 문구 초안 만들기
      </h3>
      <p id={noteId} className={`${styles.muted} ${a.note}`}>
        단추를 누르면 이 브리프의 채널·제목·대상·훅·핵심 요지·CTA·채널 항목과, 근거가 연결된 주장 문장·근거 이름이 외부 AI(Anthropic)로 전송됩니다.
        근거 메모·자료 원문·고객 연락처는 보내지 않습니다. 만든 초안은 고르기 전까지 브리프에 저장되지 않습니다. 하루 30번까지 쓸 수 있습니다.
      </p>
      <form action={formAction} onSubmit={submit} className={a.row} noValidate>
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="briefId" value={briefId} />
        <input type="hidden" name="revision" value={revision} />
        <button
          type="submit"
          className={styles.button}
          disabled={pending || !hydrated}
          aria-describedby={hydrated ? noteId : `${noteId} ${waitId}`}
        >
          {pending ? "생성 중…" : failed ? "다시 시도" : variants.length ? "다시 만들기" : "AI 문구 생성"}
        </button>
        {!hydrated && !sharedHintId && (
          <span id={localWaitId} className={styles.muted}>
            {HYDRATION_HINT_TEXT}
          </span>
        )}
      </form>
      {/* 생성 중 안내는 늘 있는 status 영역에 글만 바꿔 넣는다(화면 읽기 프로그램이 한 번 읽음) */}
      <p role="status" className={pending ? a.pending : styles.srOnly}>
        {pending ? "AI가 카피 초안을 쓰고 있습니다… (잠시만 기다려 주세요)" : state.ok && state.message ? state.message : ""}
      </p>
      {failed && state.message && (
        <p className={styles.error} role="alert">
          {state.message} 지금까지 입력한 브리프 내용은 그대로입니다.
        </p>
      )}
      {variants.length > 0 && state.runId && (
        <ol className={a.variants} aria-label="AI 초안 목록">
          {variants.map((v, i) => (
            <li key={i} className={a.variant}>
              <div className={a.variantHead}>
                <h4 className={a.variantTitle}>AI 초안 {i + 1}</h4>
                <span className={`${styles.pill} ${styles.pillInfo}`}>초안 — 검토 후 직접 수정하세요</span>
                <span className={styles.muted}>{v.text.length}자</span>
              </div>
              <p className={a.variantText}>{v.text}</p>
              <ActionForm action={acceptBriefCopyAction} submitLabel={`이 초안을 카피 초안에 쓰기 (${i + 1})`} pendingLabel="넣는 중…" variant="secondary" className={styles.row}>
                <input type="hidden" name="runId" value={state.runId} />
                <input type="hidden" name="variant" value={i + 1} />
                <input type="hidden" name="revision" value={revision} />
              </ActionForm>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
