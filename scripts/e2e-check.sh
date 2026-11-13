#!/usr/bin/env bash
# E2E 실행 후 결과 요약과 개발 서버 오류 줄 수를 보여 준다 (검수용)
# 사용: bash scripts/e2e-check.sh [playwright 인자...]
set -u
LOG="$(mktemp)"
npx playwright test "$@" > "$LOG" 2>&1
grep -E "^\s+(ok|x)\s|passed|failed|did not run|flaky" "$LOG"
echo "dev server error lines: $(grep -cE 'WebServer\].*(Error|error|⨯|Warning|hydrat|Cannot specify)' "$LOG")"
grep -E 'WebServer\].*(Error|⨯)' "$LOG" | head -5
grep -n -A20 "1) tests" "$LOG" | grep -vE '^\S*-\s*$' | head -24
rm -f "$LOG"
