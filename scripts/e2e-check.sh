#!/usr/bin/env bash
# E2E 실행 후 결과 요약과 개발 서버 오류 줄 수를 보여 준다 (검수용)
# 사용: bash scripts/e2e-check.sh [playwright 인자...]
# 오류로 세는 줄: Next.js 오류(⨯ Error), 경고, hydration 불일치, 그리고 앱이 남기는 [기능이름] 서버 기록(console.error)
set -u
LOG="$(mktemp)"
npx playwright test "$@" > "$LOG" 2>&1
PATTERN='WebServer\].*(Error|⨯|Warning|hydrat|Cannot specify)|WebServer\] \[[A-Za-z.]+\]'
grep -E "^\s+(ok|x)\s|passed|failed|did not run|flaky" "$LOG"
echo "dev server error lines: $(grep -cE "$PATTERN" "$LOG")"
grep -E "$PATTERN" "$LOG" | head -5
grep -n -A20 "1) tests" "$LOG" | grep -vE '^\S*-\s*$' | head -24
rm -f "$LOG"
