/**
 * 백업 목록과 현재 DB·저장소 비교만 실행 (데이터를 바꾸지 않음).
 * 실행: node --env-file=.env.local scripts/backup/verify-cli.mts <백업 폴더>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Manifest } from "./common.mts";
import { verify } from "./verify.mts";

const dir = process.argv[2];
if (!dir) {
  console.error("사용법: node --env-file=.env.local scripts/backup/verify-cli.mts <백업 폴더>");
  process.exit(1);
}
await verify(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Manifest);
