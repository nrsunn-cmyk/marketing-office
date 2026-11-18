"use client";

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import styles from "../ui.module.css";
import { useHydrated } from "./use-hydrated";

const QUERY = "(max-width: 640px)";
function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/**
 * 넓은 화면에서는 본문 폼, 휴대폰에서는 같은 폼을 아래쪽 대화상자로 연다.
 *
 * BUG-MOBILE-NEWTASK-01: 예전에는 자바스크립트가 화면 폭을 확인한 뒤(hydration 뒤) 폼을 '열기' 버튼으로 바꿨다.
 * 서버는 폭을 모르므로 본문 폼을 그렸고, 휴대폰에서는 준비되는 순간 폼이 사라지고 버튼이 나타났다
 * (준비 전에는 제출 버튼이 비활성이라 눌러도 아무 일이 없고, 고르던 폼이 갑자기 없어졌다).
 * 이제 서버와 브라우저가 같은 구조(열기 버튼 + 대화상자)를 그리고, 넓은 화면/휴대폰 배치는 CSS 가 정한다.
 * - 휴대폰: 열기 버튼은 준비될 때까지 비활성 + "화면을 준비하는 중…" 안내(준비 전 제출은 일부러 막는다, use-hydrated.ts)
 * - 넓은 화면: 대화상자를 본문 폼처럼 펼쳐 보이고(CSS), 대화상자 역할·이름은 붙이지 않는다(role=none)
 * 화면 폭은 접근성 속성(역할·이름)에만 쓰고, 그리는 구조는 바꾸지 않는다.
 */
export function MobileActionSheet({ title, children }: { title: string; children: ReactNode }) {
  const mobile = useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
  const hydrated = useHydrated();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const startY = useRef<number | null>(null);
  const titleId = useId();
  const hintId = useId();

  function close() {
    dialog.current?.close();
  }
  // 휴대폰에서 연 채로 화면이 넓어지면(회전·창 크기) 대화상자를 닫아 본문 폼으로 돌아간다
  useEffect(() => {
    if (!mobile && dialog.current?.open) dialog.current.close();
  }, [mobile]);

  return (
    <div>
      <span className={styles.sheetOpenerRow}>
        <button
          ref={opener}
          type="button"
          className={styles.button}
          disabled={!hydrated}
          aria-describedby={hydrated ? undefined : hintId}
          onClick={() => dialog.current?.showModal()}
        >
          {title} 열기
        </button>
        {!hydrated && (
          <span id={hintId} className={styles.muted} role="status">
            화면을 준비하는 중…
          </span>
        )}
      </span>
      <dialog
        ref={dialog}
        className={styles.actionSheet}
        role={mobile ? undefined : "none"}
        aria-labelledby={mobile ? titleId : undefined}
        onClose={() => opener.current?.focus()}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientY < bounds.top || event.clientY > bounds.bottom || event.clientX < bounds.left || event.clientX > bounds.right) close();
        }}
      >
        <div
          className={styles.sheetHandle}
          aria-hidden="true"
          onPointerDown={(event) => {
            startY.current = event.clientY;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={(event) => {
            if (startY.current !== null && event.clientY - startY.current > 48) close();
            startY.current = null;
          }}
          onPointerCancel={() => {
            startY.current = null;
          }}
        />
        <div className={`${styles.header} ${styles.sheetHeader}`}>
          <h3 id={titleId} className={styles.subtitle}>
            {title}
          </h3>
          <button type="button" className={styles.secondaryButton} onClick={close}>
            닫기
          </button>
        </div>
        {children}
      </dialog>
    </div>
  );
}
