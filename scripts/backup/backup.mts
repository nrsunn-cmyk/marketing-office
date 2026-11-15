/**
 * 백업 (T20): DB 데이터 + 자료 파일 + 목록(manifest).
 * Supabase DB 백업에는 저장소 파일이 들어 있지 않으므로 파일을 따로 받는다 (Codex 04 §7).
 *
 * 실행: node --env-file=.env.local scripts/backup/backup.mts <백업 폴더>
 * 운영 DB: node --env-file=.env.production.local scripts/backup/backup.mts <폴더> 에 BACKUP_DB_URL(DB 연결 주소)을 함께 준다.
 *   DB 내보내기와 파일·API가 같은 프로젝트를 보는지 시작 전에 확인하고, 다르면 아무것도 받지 않고 멈춘다(BACKUP-OPS-01).
 * 주의: 백업에는 고객 자료가 들어 있다. 안전한 곳에 보관하고 공유하지 않는다.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { admin, BUCKET, resolveBackupTarget, run, tableCounts, type Manifest, type StoredFile } from "./common.mts";

const out = process.argv[2];
if (!out) {
  console.error("사용법: node --env-file=.env.local scripts/backup/backup.mts <백업 폴더>");
  process.exit(1);
}
// 대상부터 정한다. 섞이거나 애매하면 폴더도 만들지 않고 멈춘다.
let target;
try {
  target = resolveBackupTarget();
} catch (e) {
  console.error(`백업을 시작하지 않았습니다: ${(e as Error).message}`);
  process.exit(1);
}
console.log(`백업 대상: ${target.kind === "local" ? "로컬 시험 DB" : `운영 프로젝트 ${target.label}`}`);
mkdirSync(join(out, "files"), { recursive: true });

const sb = admin();

// 1) DB 데이터 (업무 데이터 + 로그인 계정)
const dumpArgs = ["db", "dump", "--data-only", "--schema", "public,auth", "-f", join(out, "data.sql"), ...target.dumpArgs];
run("supabase", dumpArgs);

// 2) 자료 파일 (DB에 기록된 체크섬과 맞는지 확인하며 받는다)
const { data: assets, error } = await sb
  .from("source_assets")
  .select("object_key, mime, bytes, checksum_sha256")
  .eq("kind", "file")
  .eq("upload_status", "stored");
if (error) throw new Error(`자료 목록 조회 실패: ${error.message}`);

const files: StoredFile[] = [];
for (const a of assets ?? []) {
  const { data, error: dlError } = await sb.storage.from(BUCKET).download(a.object_key as string);
  if (dlError || !data) throw new Error(`파일 받기 실패: ${a.object_key}: ${dlError?.message}`);
  const buf = Buffer.from(await data.arrayBuffer());
  const sha = createHash("sha256").update(buf).digest("hex");
  if (sha !== a.checksum_sha256) throw new Error(`체크섬 불일치: ${a.object_key}`);
  const path = join(out, "files", a.object_key as string);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  files.push({ key: a.object_key as string, mime: a.mime as string, bytes: buf.length, sha256: sha });
}

// 3) 목록
const { data: quotes } = await sb.from("quote_versions").select("total_won");
const manifest: Manifest = {
  createdAt: new Date().toISOString(),
  target: target.label,
  counts: await tableCounts(sb),
  files,
  quoteTotalWon: (quotes ?? []).reduce((s, q) => s + Number(q.total_won), 0),
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`백업 완료: 테이블 ${Object.keys(manifest.counts).length}개, 파일 ${files.length}개 → ${out}`);
