# 개발 도구 의존성 예외 고정

2026-11-15

## TypeScript 파서의 minimatch

`@typescript-eslint/typescript-estree`가 사용하는 minimatch만 11.0.1로 고정합니다. 상위 패키지 8.72.2의 기본 요구 범위는 ^10.2.2이므로 package.json의 경로별 overrides가 필요합니다. 다른 도구의 minimatch 3.x는 바꾸지 않습니다.

근거: [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). 권고의 영향 범위는 7.0.0 이상·11.0.1 미만이며 수정 버전은 11.0.1입니다. npm audit의 moderate 보고 7개는 이 권고가 TypeScript ESLint 의존 경로로 전파된 결과입니다.

주요 버전을 넘기는 예외이므로 일반 lint만으로 판단하지 않았습니다. tests/unit/parser-glob-compat.test.ts에서 실제 파서의 allowDefaultProject 경로를 실행해 일반 파일·숨김 파일 허용과 하위 폴더 차단을 확인합니다. 전체 verify와 운영용 빌드도 통과해야 합니다.

이번 변경은 개발 의존성에 한정됩니다. 운영 패키지나 앱 기능·인증·DB 구조는 바꾸지 않습니다. npm audit 0건은 실행 시점의 등록된 보안 권고 기준이며 모든 보안 문제의 부재를 의미하지 않습니다.

## 이후 관리

상위 TypeScript ESLint가 해당 보안 수정 버전을 정식으로 요구하게 되면 overrides 제거를 검토합니다. 제거한 뒤 npm ci·npm audit·파서 호환성 시험·전체 verify·빌드를 확인하고 병합합니다. 필요 없이 다른 패키지에 전역 override를 확대하지 않습니다.
