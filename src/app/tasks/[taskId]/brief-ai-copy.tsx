"use client";

import { startTransition, useActionState, useId, useState, type FormEvent } from "react";
import type { BriefCopyChoice } from "@/features/brief/ai-copy";
import { acceptBriefCopyAction, generateBriefCopyAction, type BriefCopyFormState } from "@/features/brief/actions";
import { ActionForm } from "../../_components/action-form";
import { HYDRATION_HINT_TEXT, useHydrationHint } from "../../_components/hydration-hint";
import { useHydrated } from "../../_components/use-hydrated";
import styles from "../../ui.module.css";
import { costText, PROVIDER_SHORT_NAMES } from "./ai-cost";
import a from "./brief-ai.module.css";

const EMPTY: BriefCopyFormState = {};

/**
 * 브리프 AI 문구 초안(DEC08-UI-01, 주인님 DEC-08 B·DEC-08-R1, AGY 시안 BRIEF-AI-UI-01 의 6상태).
 * - 공급자·모델: 서버가 준 선택지(listBriefCopyChoices — 키 있는 공급자만, 서버 고정 목록)에서만 고른다.
 *   공급자가 하나면 '공급자: Claude' 배지, 여럿이면 플랫폼 선택 칸. 모델마다 1회 대략 비용(ai-cost.ts 어림).
 * - 선택지가 비면(키 없음) 이 부품을 그리지 않는다(부르는 쪽 brief-panel 이 판단)
 * - 기본: 'AI 문구 생성' 단추와 전송 범위 안내 / 생성 중: 단추·선택 칸 끔 + 상태 안내 / 완료: 변형마다 '초안' 표시와 '이 초안 쓰기'
 * - 실패·한도: 서버가 준 한국어 문구(role=alert)와 '다시 시도'. 생성은 브리프를 바꾸지 않으므로 입력 내용은 그대로다
 * - 채택하면 서버가 카피 초안에 넣고 화면을 새로 그린다(이 부품은 부르는 쪽이 revision 으로 다시 만든다)
 * 전송 범위 안내·주의는 AGY 확정 문구 COPY-DEC08-01(13:12 최종판) 그대로({공급자} = 고른 공급자 이름).
 */
export function BriefAiCopy({ taskId, briefId, revision, choices }: { taskId: string; briefId: string; revision: number; choices: BriefCopyChoice[] }) {
  const [state, formAction, pending] = useActionState(generateBriefCopyAction, EMPTY);
  const hydrated = useHydrated();
  const localWaitId = useId();
  const sharedHintId = useHydrationHint();
  const waitId = sharedHintId ?? localWaitId;
  const id = useId();
  const noteId = `${id}-note`;
  const costId = `${id}-cost`;

  // 기본 공급자: 서버와 같게 Claude(있으면), 없으면 첫 공급자. 모델은 그 공급자의 기본 모델
  const firstProvider = (choices.find((c) => c.provider === "anthropic") ?? choices[0]).provider;
  const defaultModel = (p: string) => {
    const c = choices.find((x) => x.provider === p);
    return (c?.models.find((m) => m.isDefault) ?? c?.models[0])?.id ?? "";
  };
  const [provider, setProvider] = useState<string>(firstProvider);
  const [model, setModel] = useState(() => defaultModel(firstProvider));
  const current = choices.find((c) => c.provider === provider) ?? choices[0];
  const currentModel = current.models.find((m) => m.id === model) ?? current.models[0];
  const providerName = PROVIDER_SHORT_NAMES[current.provider];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    startTransition(() => formAction(fd));
  }

  const failed = !pending && !state.ok && Boolean(state.message);
  const variants = !pending && state.ok ? (state.variants ?? []) : [];
  const madeWith = state.model ? choices.flatMap((c) => c.models).find((m) => m.id === state.model)?.label ?? state.model : null;

  return (
    <section aria-labelledby={`${id}-title`} className={`${a.box} ${variants.length ? a.boxDraft : ""}`}>
      <h3 id={`${id}-title`} className={a.title}>
        AI 문구 초안 만들기
      </h3>
      <div id={noteId} className={a.note}>
        <p className={styles.muted}>
          {`외부 AI(${providerName})로 이 브리프의 입력 내용(채널·제목·대상·훅·핵심 메시지·CTA·채널 항목)과 근거가 연결된 주장 문장·근거 이름이 전송됩니다. 근거 메모·자료 원문·고객 연락처·회사 프로필 원문은 보내지 않습니다.`}
        </p>
        <p className={a.caution}>※ 제목·본문·주장에 고객명을 직접 쓰면 그대로 전송되니 주의하세요.</p>
      </div>
      <form action={formAction} onSubmit={submit} className={a.form} noValidate>
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="briefId" value={briefId} />
        <input type="hidden" name="revision" value={revision} />
        <div className={a.choices}>
          {choices.length === 1 ? (
            <p className={a.single}>
              <input type="hidden" name="provider" value={current.provider} />
              <span className={`${styles.pill} ${styles.pillNeutral}`}>공급자: {current.label}</span>
            </p>
          ) : (
            <div className={styles.field}>
              <label htmlFor={`${id}-provider`}>플랫폼 (키 설정된 공급자)</label>
              <select
                id={`${id}-provider`}
                name="provider"
                value={provider}
                disabled={pending}
                onChange={(e) => {
                  setProvider(e.target.value);
                  setModel(defaultModel(e.target.value));
                }}
              >
                {choices.map((c) => (
                  <option key={c.provider} value={c.provider}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className={styles.field}>
            <label htmlFor={`${id}-model`}>모델 선택</label>
            <select id={`${id}-model`} name="model" value={currentModel.id} disabled={pending} onChange={(e) => setModel(e.target.value)} aria-describedby={costId}>
              {current.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {`${m.label} — ${m.note} (1회 ${costText(m)})`}
                </option>
              ))}
            </select>
            <span id={costId} className={styles.muted}>
              {`1회 대략 비용: ${costText(currentModel)} 추정 (공개 요금표 기준, 실제 과금과 다를 수 있음)`}
            </span>
          </div>
        </div>
        <div className={a.row}>
          <button type="submit" className={styles.button} disabled={pending || !hydrated} aria-describedby={hydrated ? noteId : `${noteId} ${waitId}`}>
            {pending ? "생성 중…" : failed ? "다시 시도" : variants.length ? "다시 만들기" : "AI 문구 생성"}
          </button>
          {!hydrated && !sharedHintId && (
            <span id={localWaitId} className={styles.muted}>
              {HYDRATION_HINT_TEXT}
            </span>
          )}
        </div>
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
        <>
          {madeWith && <p className={styles.muted}>만든 모델: {madeWith}</p>}
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
        </>
      )}
    </section>
  );
}
