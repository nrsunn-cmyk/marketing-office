import Link from "next/link";
import {
  lastDecisions,
  PROFILE_STATUS_LABELS,
  profileDiff,
  profileStatusOf,
  type ProfileDecision,
  type ProfileReviewStatus,
} from "@/domain/profile/review";
import type { ProfileVersion } from "@/features/clients/server";
import { decideProfileAction } from "@/features/profiles/actions";
import { profileContentHash } from "@/features/profiles/server";
import { ActionForm } from "../../_components/action-form";
import { formatDateTimeIn } from "../../_components/format-time";
import styles from "../../ui.module.css";

const TONE: Record<ProfileReviewStatus, string> = { approved: "근거로 사용 가능", revoked: "근거로 사용 불가", pending: "근거로 사용 불가" };

/**
 * P2-b 회사 프로필 버전 검토·승인(앱 내부 확인. 고객 승인을 뜻하지 않는다).
 * 승인 기록은 추가 전용이며 정의자 RPC 로만 남는다. 수정 요청은 DB 결정 값이 없어 미지원으로 표시한다.
 */
export function ProfileReview({
  clientId,
  versions,
  decisions,
  selectedVersion,
  userId,
  timeZone,
}: {
  clientId: string;
  versions: ProfileVersion[]; // 최신순
  decisions: ProfileDecision[];
  selectedVersion: number | null;
  userId: string;
  timeZone: string;
}) {
  if (versions.length === 0) {
    return (
      <section className={styles.section} aria-labelledby="profile-review">
        <h2 id="profile-review" className={styles.subtitle}>
          프로필 버전 검토·승인
        </h2>
        <p className={styles.muted}>아직 회사 프로필 버전이 없습니다. 위에서 프로필을 저장하면 여기서 검토하고 승인할 수 있습니다.</p>
      </section>
    );
  }
  const last = lastDecisions(decisions);
  const selected = versions.find((v) => v.version === selectedVersion) ?? versions[0]!;
  const prev = versions.find((v) => v.version === selected.version - 1) ?? null;
  const selLast = last.get(selected.id);
  const status = profileStatusOf(selLast);
  const changes = profileDiff(prev, selected);
  const hash = profileContentHash(selected);
  const history = decisions.filter((d) => d.versionId === selected.id).slice().reverse();

  return (
    <section className={styles.section} aria-labelledby="profile-review">
      <h2 id="profile-review" className={styles.subtitle}>
        프로필 버전 검토·승인
      </h2>
      <p className={styles.muted}>
        승인한 버전만 전략의 근거로 쓸 수 있습니다. 승인은 이 앱 안의 내부 확인이며 고객의 승인을 뜻하지 않습니다. 승인 기록은 지워지지 않습니다.
      </p>

      <ul className={styles.list} aria-label="프로필 버전 목록">
        {versions.map((v) => {
          const st = profileStatusOf(last.get(v.id));
          return (
            <li key={v.id} className={styles.listItem}>
              <span>
                {v.id === selected.id ? <strong>{v.version}번 버전 (보는 중)</strong> : <Link href={`?pv=${v.version}#profile-review`} className={styles.touchLink}>{v.version}번 버전</Link>}
                {" · "}
                <span className={styles.muted}>{formatDateTimeIn(v.created_at, timeZone)}</span>
              </span>
              <span className={styles.badge}>{PROFILE_STATUS_LABELS[st]}</span>
            </li>
          );
        })}
      </ul>

      <div className={styles.section} aria-label={`${selected.version}번 버전 검토`}>
        <div className={styles.header}>
          <h3>
            {selected.version}번 버전 {prev ? `(${prev.version}번 대비 변경)` : "(첫 버전)"}
          </h3>
          <span className={styles.row}>
            <span className={styles.badge}>{PROFILE_STATUS_LABELS[status]}</span>
            <span className={styles.badge}>{TONE[status]}</span>
          </span>
        </div>
        <p className={`${styles.muted} ${styles.breakAny}`}>내용 확인값 {hash} · 승인할 때 이 값과 저장된 내용이 같은지 서버가 다시 확인합니다.</p>

        {changes.length === 0 ? (
          <p className={styles.muted}>{prev ? "이전 버전과 내용이 같습니다." : "입력된 내용이 없습니다."}</p>
        ) : (
          <ul aria-label="변경 내용">
            {changes.map((c) => (
              <li key={c.key}>
                <strong>{c.label}</strong>
                {c.kind === "text" ? (
                  <>
                    {prev && <span className={styles.muted}> 이전: {c.before || "(비어 있음)"}</span>}
                    <br />
                    지금: {c.after || "(비어 있음)"}
                  </>
                ) : (
                  <>
                    {c.added.length > 0 && <span> · 더함: {c.added.join(", ")}</span>}
                    {c.removed.length > 0 && <span className={styles.muted}> · 뺌: {c.removed.join(", ")}</span>}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {history.length > 0 && (
          <details>
            <summary>이 버전의 결정 기록 {history.length}건</summary>
            <ul className={styles.list}>
              {history.map((d) => (
                <li key={d.seq} className={styles.listItem}>
                  <span>
                    {d.decision === "approved" ? "승인" : d.decision === "revoked" ? "승인 철회" : d.decision}
                    {d.comment?.trim() && (
                      // 결정별로 이름을 나눠 승인 메모와 철회 사유를 섞지 않는다. 줄바꿈은 보존하고 텍스트로만 출력한다.
                      <span style={{ display: "block", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                        {d.decision === "revoked" ? "철회 사유" : "승인 메모"}: {d.comment.trim()}
                      </span>
                    )}
                  </span>
                  <span className={styles.muted}>
                    {d.actorId === userId ? "본인" : "다른 사용자"} · {formatDateTimeIn(d.createdAt, timeZone)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className={styles.row} aria-label="결정">
          {status === "approved" ? (
            <ActionForm action={decideProfileAction} submitLabel="승인 철회" pendingLabel="처리 중…" variant="secondary">
              <DecisionFields clientId={clientId} versionId={selected.id} decision="revoked" seq={selLast?.seq ?? 0} hash={hash} />
              <p className={styles.muted}>철회하면 이 버전을 근거로 새 전략을 만들 수 없습니다. 이미 만든 전략에는 경고가 표시됩니다.</p>
            </ActionForm>
          ) : (
            <ActionForm action={decideProfileAction} submitLabel={`${selected.version}번 버전 승인`} pendingLabel="승인 중…">
              <DecisionFields clientId={clientId} versionId={selected.id} decision="approved" seq={selLast?.seq ?? 0} hash={hash} />
              <div className={styles.field}>
                <label htmlFor="profile-decide-comment">메모 (선택)</label>
                <textarea id="profile-decide-comment" name="comment" maxLength={1000} />
              </div>
            </ActionForm>
          )}
        </div>
        <p className={styles.muted}>
          수정 요청: 지원하지 않습니다(프로필 승인 기록에는 &lsquo;수정 요청&rsquo; 결정이 없습니다). 고칠 점이 있으면 위 회사 프로필에서{" "}
          <a href="#profile" className={styles.touchLink}>
            새 버전으로 저장
          </a>해 새 초안을 만든 뒤 그 버전을 승인해 주세요.
        </p>
      </div>
    </section>
  );
}

function DecisionFields({ clientId, versionId, decision, seq, hash }: { clientId: string; versionId: string; decision: string; seq: number; hash: string }) {
  return (
    <>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="versionId" value={versionId} />
      <input type="hidden" name="decision" value={decision} />
      <input type="hidden" name="expectedLastSeq" value={seq} />
      <input type="hidden" name="contentHash" value={hash} />
    </>
  );
}
