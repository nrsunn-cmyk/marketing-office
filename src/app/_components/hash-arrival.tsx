"use client";

import { useEffect } from "react";

/**
 * UX-G1-G4-FRONT-01 r2(Tester QA-UX-G1-G4-01 F1): 스트리밍(Suspense)으로 구획이 늦게 그려지면, 주소의 #해시로 들어와도
 * 브라우저 기본 해시 이동이 이미 지나가 화면이 맨 위에 머문다. 이 부품을 구획 안에 두면, 구획이 그려질 때
 * 주소 해시가 id 와 같을 때만 한 번 그 구획으로 옮긴다(움직임 줄이기 설정이면 바로). 아무것도 그리지 않는다.
 */
export function HashArrival({ id }: { id: string }) {
  useEffect(() => {
    if (decodeURIComponent(window.location.hash.slice(1)) !== id) return;
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [id]);
  return null;
}
