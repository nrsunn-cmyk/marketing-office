"use client";

import { startTransition, useActionState, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { PublicInquiryStatus } from "@/features/public-inquiries/contract";
import { EMPTY_FORM_STATE, type FormState } from "../../_components/form-state";
import { useHydrated } from "../../_components/use-hydrated";
import ad from "../admin.module.css";
import { INQ_COPY as C, INQ_DELETE_REASON_MAX } from "./inquiry-copy";

/**
 * NADAUM-INQUIRY-DELETE-FRONT-01 공개 상담 건별 영구 삭제(AGY INQUIRY-ADMIN-DELETE-SPEC-01 3절).
 * window.confirm 대신 인라인 2단계 확인: [삭제] → 안내·선택 사유·[영구 삭제]/[취소].
 * - 진행 중에는 두 단추를 막고 '삭제 중...'(중복 제출 방지). 자바스크립트가 붙기 전에는 [삭제]를 막는다(hydration 전 폼 전송 방지).
 * - 성공하면 서버 동작이 상세를 닫은 목록 주소로 보낸다(상단 안내는 page.tsx). 실패하면 role=alert 로 이유를 보인다.
 * - [취소]·Esc 로 닫으면 초점을 [삭제]로 돌린다.
 */
export function DeleteInquiry({
  id,
  refCode,
  status,
  cursor,
  action,
}: {
  id: string;
  refCode: string;
  status: PublicInquiryStatus | null;
  cursor: string | null;
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, EMPTY_FORM_STATE);
  const hydrated = useHydrated();
  const openRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  const wasOpen = useRef(false);
  const uid = useId();
  const regionId = `${uid}-confirm`;
  const warnId = `${uid}-warn`;

  // 열면 사유 칸으로, 닫으면 [삭제]로 초점을 옮긴다(처음 그릴 때는 옮기지 않는다).
  // 열 때는 사유 칸을 화면 가운데로 올린다 — 사유 칸과 [영구 삭제]/[취소]가 휴대폰 아래 고정 메뉴에 가리지 않게
  // (AGY INQUIRY-ADMIN-DELETE-SPEC-01 4절, Tester QA-NADAUM-INQUIRY-DELETE-01 R1). 움직임 줄이기 설정이면 바로 옮긴다
  useEffect(() => {
    if (open) {
      const reason = reasonRef.current;
      reason?.focus({ preventScroll: true });
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      reason?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    }
    else if (wasOpen.current) openRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  function submit(event: FormEvent<HTMLFormElement>) {
    // React 19 의 <form action> 자동 비우기를 피해 실패 때 적은 사유를 남긴다(ActionForm 과 같은 방식)
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    startTransition(() => formAction(fd));
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !pending) {
      event.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div className={ad.deleteBox}>
      {!open ? (
        <button
          ref={openRef}
          type="button"
          className={ad.dangerOutline}
          onClick={() => setOpen(true)}
          disabled={!hydrated}
          aria-label={`${refCode} 상담 ${C.deleteOpen}`}
        >
          {C.deleteOpen}
        </button>
      ) : (
        <div id={regionId} role="group" aria-labelledby={warnId} className={ad.deleteConfirm} onKeyDown={onKeyDown}>
          <p id={warnId} className={ad.deleteWarn}>
            {C.deleteConfirm}
          </p>
          <form onSubmit={submit} action={formAction} noValidate className={ad.deleteForm}>
            <input type="hidden" name="id" value={id} />
            {status && <input type="hidden" name="status" value={status} />}
            {cursor && <input type="hidden" name="before" value={cursor} />}
            <input
              ref={reasonRef}
              type="text"
              name="reason"
              maxLength={INQ_DELETE_REASON_MAX}
              placeholder={C.deleteReason}
              aria-label={C.deleteReason}
              autoComplete="off"
              className={ad.deleteReason}
              disabled={pending}
            />
            {state.message && !state.ok && (
              <p className={ad.deleteError} role="alert">
                {state.message}
              </p>
            )}
            <div className={ad.deleteActions}>
              <button type="submit" className={ad.dangerSolid} disabled={pending || !hydrated} aria-describedby={warnId}>
                {pending ? C.deletePending : C.deleteSubmit}
              </button>
              <button type="button" className={ad.neutralButton} onClick={() => setOpen(false)} disabled={pending}>
                {C.deleteCancel}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
