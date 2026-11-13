/**
 * 복원 검증 (T20): 백업 목록과 현재 DB·저장소를 비교한다.
 * - 테이블별 행 수 일치
 * - 외래키 고아 행 없음 (모든 public 외래키)
 * - 파일이 모두 열리고 체크섬이 DB 기록·백업 목록과 같음
 * - 확정 견적의 항목 합계를 다시 계산해 고정 금액과 같음
 */
import { createHash } from "node:crypto";
import { admin, BUCKET, ORPHAN_CHECK_SQL, psql, tableCounts, type Manifest } from "./common.mts";

export async function verify(manifest: Manifest): Promise<void> {
  const sb = admin();
  const problems: string[] = [];

  const counts = await tableCounts(sb);
  for (const [t, n] of Object.entries(manifest.counts)) {
    if (counts[t] !== n) problems.push(`행 수 불일치 ${t}: 백업 ${n} / 복원 ${counts[t]}`);
  }

  try {
    psql(ORPHAN_CHECK_SQL);
  } catch (e) {
    problems.push(`외래키 고아 행: ${(e as Error).message.slice(0, 500)}`);
  }

  const { data: assets } = await sb.from("source_assets").select("object_key, checksum_sha256").eq("kind", "file").eq("upload_status", "stored");
  const dbSum = new Map((assets ?? []).map((a) => [a.object_key as string, a.checksum_sha256 as string]));
  for (const f of manifest.files) {
    const { data, error } = await sb.storage.from(BUCKET).download(f.key);
    if (error || !data) {
      problems.push(`파일 열기 실패: ${f.key}`);
      continue;
    }
    const sha = createHash("sha256").update(Buffer.from(await data.arrayBuffer())).digest("hex");
    if (sha !== f.sha256 || sha !== dbSum.get(f.key)) problems.push(`파일 체크섬 불일치: ${f.key}`);
  }

  // 확정 견적 금액을 항목에서 다시 계산 (앱 코드와 독립적으로 DB 안에서 같은 규칙으로)
  const mismatches = psql(`
    with l as (
      select qi.quote_version_id,
             sum(app.round_half_up_div(qi.quantity_hundredths::numeric * qi.unit_price_won, 100)) as s,
             bool_and(app.round_half_up_div(qi.quantity_hundredths::numeric * qi.unit_price_won, 100) = qi.line_amount_won) as lines_ok
        from quote_items qi group by 1
    ), c as (
      select qv.id, qv.subtotal_won, qv.tax_won, qv.total_won, l.lines_ok,
             case when qv.tax_mode = 'INCLUSIVE' then app.round_half_up_div(l.s * 10000, 10000 + qv.tax_rate_bp) else l.s end as sub,
             case when qv.tax_mode = 'INCLUSIVE' then l.s else l.s + case when qv.tax_mode = 'EXCLUSIVE' then app.round_half_up_div(l.s * qv.tax_rate_bp, 10000) else 0 end end as total
        from quote_versions qv join l on l.quote_version_id = qv.id
    )
    select count(*) from c where not lines_ok or sub <> subtotal_won or total <> total_won or total - sub <> tax_won;`).trim();
  if (mismatches !== "0") problems.push(`견적 금액 불일치 ${mismatches}건`);
  const { data: qvs } = await sb.from("quote_versions").select("total_won");
  const total = (qvs ?? []).reduce((s, q) => s + Number(q.total_won), 0);
  if (total !== manifest.quoteTotalWon) problems.push(`확정 견적 총액 불일치: 백업 ${manifest.quoteTotalWon} / 복원 ${total}`);

  if (problems.length > 0) {
    throw new Error(`복원 검증 실패:\n- ${problems.join("\n- ")}`);
  }
  console.log(
    `검증 통과: 테이블 ${Object.keys(counts).length}개 행 수 일치, 외래키 고아 행 0, 파일 ${manifest.files.length}개 체크섬 일치, 확정 견적 ${qvs?.length ?? 0}건 금액 재계산 일치`,
  );
}
