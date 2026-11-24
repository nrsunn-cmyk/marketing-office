"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { browserLandingEnv, landOnHash } from "./hash-landing";

/**
 * UX-HASH-SCROLL-GLOBAL-01: 앱 전체에서 #해시 대상이 늦게 그려져도 그 자리로 한 번 옮긴다(규칙은 hash-landing.ts).
 * 주소(경로·검색어)가 바뀔 때와 같은 화면 안 #해시가 바뀔 때(hashchange) 시작하고, 다음 이동이나 화면을 떠날 때 정리한다.
 * 아무것도 그리지 않는다. 루트 layout 에서 Suspense 안에 둔다(useSearchParams).
 */
export function GlobalHashScroll() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";

  useEffect(() => {
    let stop = landOnHash(browserLandingEnv());
    const onHash = () => {
      stop();
      stop = landOnHash(browserLandingEnv());
    };
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
      stop();
    };
  }, [pathname, search]);

  return null;
}
