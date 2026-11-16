"use client";

import { useSyncExternalStore } from "react";

/**
 * BUG-SESSION-HYDRATION-01: 화면에 자바스크립트가 붙기(hydration) 전에는 false, 붙은 뒤에는 true.
 *
 * 왜 필요한가: hydration 전에 서버 동작(server action) 폼을 누르면 브라우저 기본 폼 전송(점진적 향상 경로)으로
 * 보내진다. 이 경로에서 서버 동작 뒤 같은 요청 안에서 페이지를 다시 그리는데,
 *  - 개발 모드: Next.js cookies() 의 개발 전용 검사가 InvariantError 를 던져 오류 화면이 된다
 *    (node_modules/next/dist/server/request/cookies.js makeUntrackedCookiesWithDevWarnings).
 *  - 운영 빌드: 서버는 결과를 보내지만 브라우저가 화면을 되살리지 못해 빈 화면이 된다.
 * 로그인 확인(Supabase 세션)은 모든 서버 동작에서 cookies() 가 필요하므로 이 경로를 앱에서 피한다.
 * 제출 버튼을 hydration 전에는 비활성으로 두면 기본 폼 전송이 일어나지 않는다(HTML: 비활성 기본 버튼은 Enter 제출도 막는다).
 */
const subscribe = () => () => {};
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true, // 브라우저(hydration 뒤)
    () => false, // 서버 렌더·hydration 중
  );
}
