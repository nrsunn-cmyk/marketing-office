"use client";

import { useEffect, useState } from "react";
import styles from "../../ui.module.css";

/** 전달 시각 입력. 기본값은 지금(브라우저 시간), 서버가 시간대를 맞출 수 있게 차이(분)를 함께 보낸다. */
export function DeliveredAtField() {
  const [value, setValue] = useState("");
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    // 화면 준비 뒤에 한 번만 현재 시각을 채운다(서버 렌더 값과 어긋나지 않게)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`);
    setOffset(now.getTimezoneOffset());
  }, []);
  return (
    <div className={styles.field}>
      <label htmlFor="delivered-at">전달 시각</label>
      <input id="delivered-at" name="deliveredAt" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
      <input type="hidden" name="tzOffset" value={offset} />
    </div>
  );
}
