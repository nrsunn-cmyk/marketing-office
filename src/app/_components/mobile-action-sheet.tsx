"use client";

import { useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import styles from "../ui.module.css";

function subscribe(onChange: () => void) {
  const media = window.matchMedia("(max-width: 640px)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** 넓은 화면에서는 본문 폼, 휴대폰에서는 같은 폼을 아래쪽 대화상자로 연다. */
export function MobileActionSheet({ title, children }: { title: string; children: ReactNode }) {
  const mobile = useSyncExternalStore(subscribe, () => window.matchMedia("(max-width: 640px)").matches, () => false);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const startY = useRef<number | null>(null);
  const titleId = useId();

  if (!mobile) return <>{children}</>;

  function close() {
    dialog.current?.close();
  }

  return (
    <>
      <button ref={opener} type="button" className={styles.button} onClick={() => dialog.current?.showModal()}>
        {title} 열기
      </button>
      <dialog
        ref={dialog}
        className={styles.actionSheet}
        aria-labelledby={titleId}
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
          onPointerCancel={() => { startY.current = null; }}
        />
        <div className={styles.header}>
          <h3 id={titleId} className={styles.subtitle}>{title}</h3>
          <button type="button" className={styles.secondaryButton} onClick={close}>닫기</button>
        </div>
        {children}
      </dialog>
    </>
  );
}
