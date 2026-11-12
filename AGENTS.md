<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 이 저장소의 협업 규칙

- 공용 규칙 원본: `C:\nadaum\AGENTS.md`. 작업 점유판: `C:\nadaum\.agents\WORKBOARD.md`.
- CLI마다 `../marketing-office-wt/<cli>/` worktree와 `<cli>/*` 브랜치에서 작업한다. `main` 병합은 Codex 검수와 사용자 확인 후에 한다.
- `package.json`, lockfile, `drizzle/`, `src/server/**`, `src/domain/**`, `src/features/**`, `tests/**`는 Claude Code 소유. `design/**`, `src/styles/tokens.css`는 AGY 소유.
- 구현 계획: `C:\nadaum\Plan\Claude-Implementation-Plan-20261113\개발계획.md`.
- 변경 전후 `npm run verify`(형식검사·린트·테스트)를 통과시킨다.
