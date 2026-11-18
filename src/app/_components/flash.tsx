"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FormState } from "./form-state";
import styles from "../ui.module.css";

/**
 * 폼이 사라지는 동작의 성공 안내를 남긴다(BUNDLE-C-PREP-01, QA-E2E-FULL-01 T5·T6).
 *
 * ActionForm 은 성공 안내를 폼 안에 그린다. 그런데 '이 버전 승인'·프로젝트 상태 바꾸기·기준 맞추기·보관·근거 해제처럼
 * 성공하면 그 폼이 화면에서 빠지는 동작은 안내도 같이 사라져, 성공했는데 아무 말 없이 버튼만 없어진 것처럼 보였다.
 * - 폼이 남으면: 지금처럼 폼 안에 안내(이 장치는 아무것도 안 한다)
 * - 성공과 함께 폼이 사라지면: 그 안내를 화면 아래 공용 안내 영역(role=status)에 8초 보인다
 * 폼이 남는지는 미리 알 수 없으므로, 성공 결과를 '맡겨 두고' 폼이 안내를 그리면 찾아가고(claim),
 * 폼이 사라지면(release) 여기서 보인다. 응답 처리 순서(결과 반영 ↔ 화면 갱신)가 어느 쪽이어도 맞게 둘 다 처리한다.
 */
type Action = (prev: FormState, fd: FormData) => Promise<FormState>;
interface Flash {
  mount: (key: object) => void;
  wrap: (key: object, action: Action) => Action;
  claim: (key: object) => void;
  release: (key: object) => void;
}
const FlashContext = createContext<Flash | null>(null);
export const useFlash = () => useContext(FlashContext);

const SHOW_MS = 8000;

export function FlashProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; n: number } | null>(null);
  const pending = useRef(new Map<object, string>());
  const gone = useRef(new WeakSet<object>());
  const seq = useRef(0);

  const api = useMemo<Flash>(() => {
    const show = (text: string) => setMsg({ text, n: ++seq.current });
    return {
      mount: (key) => {
        gone.current.delete(key); // 개발 모드(StrictMode)의 해제→다시 붙임 뒤에도 '사라짐' 표시가 남지 않게
      },
      wrap: (key, action) => async (prev, fd) => {
        const r = await action(prev, fd);
        if (r.ok && r.message) {
          if (gone.current.has(key)) show(r.message); // 결과보다 화면 갱신이 먼저 와서 폼이 이미 사라졌다
          else pending.current.set(key, r.message);
        }
        return r;
      },
      claim: (key) => {
        pending.current.delete(key); // 폼이 남아 직접 안내를 그렸다
      },
      release: (key) => {
        gone.current.add(key);
        const m = pending.current.get(key);
        if (m) {
          pending.current.delete(key);
          show(m); // 성공과 함께 폼이 사라졌다
        }
      },
    };
  }, []);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), SHOW_MS);
    return () => clearTimeout(t);
  }, [msg]);

  return (
    <FlashContext.Provider value={api}>
      {children}
      {/* 영역은 늘 두고(화면 읽기 프로그램이 바뀐 내용을 읽도록) 글만 바꾼다 */}
      <div className={styles.flashRegion} role="status" aria-live="polite">
        {msg && (
          <p key={msg.n} className={`${styles.notice} ${styles.flashToast}`}>
            <span>{msg.text}</span>
            <button type="button" className={styles.secondaryButton} onClick={() => setMsg(null)}>
              닫기
            </button>
          </p>
        )}
      </div>
    </FlashContext.Provider>
  );
}
