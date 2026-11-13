import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // 견적서 PDF는 실행 중에 글꼴 파일을 읽으므로 배포 묶음에 글꼴을 꼭 넣는다
  outputFileTracingIncludes: {
    "/quote-versions/*/pdf": ["./node_modules/pretendard/dist/public/static/alternative/Pretendard-{Regular,Bold}.ttf"],
  },
  experimental: {
    // 자료 파일은 10MB까지(D05). 여러 부분으로 나뉜 폼 데이터의 머리말 여유를 더해 11MB.
    serverActions: { bodySizeLimit: "11mb" },
    // proxy 는 요청 본문을 이 크기까지만 복사해 둔다(기본 10MB). 넘으면 파일이 잘린다.
    proxyClientMaxBodySize: "11mb",
  },
};

export default nextConfig;
