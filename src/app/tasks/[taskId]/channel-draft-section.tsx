import Link from "next/link";
import type { ReactNode } from "react";
import { unstable_rethrow } from "next/navigation";
import { CHANNEL_DRAFT_CHANNEL_LABEL, CHANNEL_DRAFT_LANGUAGE_LABEL, CHANNEL_DRAFT_LIMITS } from "@/domain/channel-draft/constants";
import {
  archiveChannelDraftAction,
  createChannelDraftAction,
  rebaseChannelDraftAction,
  recordChannelPublicationAction,
  updateChannelDraftAction,
  voidChannelPublicationAction,
} from "@/features/channel-draft/actions";
import { getChannelDraftsFor, type ChannelDraftView, type ChannelDraftsForBrief } from "@/features/channel-draft/server";
import type { BriefDetail } from "@/features/brief/server";
import type { FunnelBoard } from "@/features/funnel/server";
import { ActionForm } from "../../_components/action-form";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import cd from "./channel-draft.module.css";
import { ChannelDraftEditForm } from "./channel-draft-edit-form";
import { ChannelDraftExportPanel } from "./channel-draft-export";
import { activePublicationCount, draftToForm, formatKst, kstLocalNow, publicationRows } from "./channel-draft-form";

/**
 * P2G-UI-01 채널 초안(티스토리 블로그·한국어). 브리프 영역 바로 아래. 시안 Design/P2-next-concepts/channel-draft.html(R1).
 * 서버 src/features/channel-draft(P2G-BACKEND-01). 화면 규칙(인계 5절):
 * - 복사·내보내기는 서버가 준 draft.export 만 쓰고, 미리 보기에 HTML 을 넣지 않는다(본문은 글자로).
 * - 게시 기록 링크는 서버가 준 publication.url 에만, rel="noopener noreferrer" target="_blank".
 * - 「게시」·「발행」·「티스토리로 보내기」 단추는 없다(R08, 외부 요청 없음).
 * 읽기 전용: 프로젝트 보관·작업 취소(영역 전체), 초안 보관(그 초안만 — 복사·내보내기만 남음, 기록 취소도 안 됨 D4).
 * 브리프 보관·카드 보관은 새로 만들기만 막고 기존 초안 편집은 막지 않는다(서버와 같음).
 */
export async function ChannelDraftSection({ board, detail, readOnly, taskId }: { board: FunnelBoard; detail: BriefDetail; readOnly: boolean; taskId: string }) {
  let data: ChannelDraftsForBrief | null;
  try {
    data = await getChannelDraftsFor(board, detail);
  } catch (e) {
    unstable_rethrow(e);
    console.error("[channel-draft]", e);
    return (
      <Shell>
        <p className={styles.error} role="alert">
          티스토리 초안을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
        <p>
          <Link href={`/tasks/${taskId}?brief=${detail.brief.id}#channel-drafts`} className={`${styles.secondaryButton} ${f.touch}`}>
            다시 불러오기
          </Link>
        </p>
      </Shell>
    );
  }
  if (!data) return null;
  return <ChannelDraftBody data={data} briefId={detail.brief.id} briefArchived={detail.brief.archived} readOnly={readOnly} approvedVersion={board.strategy.approvedVersion?.version ?? null} />;
}

/** 그리는 부분(동기). 시험·화면 점검은 이 함수를 쓴다 */
export function ChannelDraftBody({
  data,
  briefId,
  briefArchived,
  readOnly,
  approvedVersion,
}: {
  data: ChannelDraftsForBrief;
  briefId: string;
  briefArchived: boolean;
  readOnly: boolean;
  approvedVersion: number | null;
}) {
  const active = data.drafts.filter((d) => !d.archived);
  const archived = data.drafts.filter((d) => d.archived);

  return (
    <Shell count={`${data.activeCount}/${data.limit}개`}>
      {readOnly && (
        <p className={styles.muted} role="note">
          보관한 프로젝트이거나 취소한 작업이라 티스토리 초안은 읽기와 복사·내보내기만 할 수 있습니다.
        </p>
      )}
      {!readOnly && briefArchived && data.drafts.length > 0 && (
        <p className={styles.muted} role="note">
          원본 브리프가 보관되었습니다. 이미 만든 초안은 계속 고치고 복사·게시 기록을 남길 수 있고, 새 초안 만들기만 막힙니다.
        </p>
      )}

      {!readOnly &&
        (data.canCreate ? (
          <ActionForm action={createChannelDraftAction} submitLabel={active.length === 0 ? "티스토리 초안 만들기" : "티스토리 초안 하나 더 만들기"} pendingLabel="만드는 중…" className={f.inlineForm}>
            <input type="hidden" name="briefId" value={briefId} />
            <p className={`${styles.muted} ${f.keep}`}>지금 브리프 내용을 복사해 초안의 처음 글(제목·태그·본문·메타 설명)을 만듭니다. AI 는 쓰지 않습니다.</p>
          </ActionForm>
        ) : (
          <p className={`${styles.notice} ${cd.cdBlocked}`} role="note">
            <strong>새 초안을 만들 수 없습니다:</strong> {data.createBlockedReason}
          </p>
        ))}

      {data.drafts.length === 0 ? (
        <div className={styles.emptyState}>
          <strong>아직 티스토리 초안이 없습니다.</strong>
          <p className={styles.muted}>준비 완료인 블로그 브리프에서 만들 수 있습니다. 한 브리프에 {CHANNEL_DRAFT_LIMITS.perBrief}개까지 둘 수 있습니다.</p>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <ul className={cd.cdList} aria-label="티스토리 초안 목록">
              {active.map((d) => (
                <DraftCard key={d.id} d={d} readOnly={readOnly} approvedVersion={approvedVersion} />
              ))}
            </ul>
          )}
          {archived.length > 0 && (
            <details className={f.inlineDetails}>
              <summary>보관한 초안 {archived.length}개</summary>
              <ul className={cd.cdList} aria-label="보관한 티스토리 초안 목록">
                {archived.map((d) => (
                  <DraftCard key={d.id} d={d} readOnly={readOnly} approvedVersion={approvedVersion} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Shell>
  );
}

function DraftCard({ d, readOnly, approvedVersion }: { d: ChannelDraftView; readOnly: boolean; approvedVersion: number | null }) {
  const editable = !readOnly && !d.archived;
  const rows = publicationRows(d.publications);
  const activePubs = activePublicationCount(d.publications);
  const pubFull = activePubs >= CHANNEL_DRAFT_LIMITS.publicationsPerDraft;
  const headingId = `cd-${d.id}`;

  return (
    <li className={`${cd.cdCard} ${d.archived ? cd.cdCardArchived : ""} ${d.stale ? cd.cdCardStale : ""}`}>
      <article aria-labelledby={headingId} className={cd.cdArticle}>
        <h3 id={headingId} className={cd.cdCardTitle}>
          {d.title}
        </h3>
        <p className={cd.cdBadges}>
          <span className={`${styles.badge} ${cd[`cdStatus_${d.displayStatus}`] ?? ""}`}>{d.displayLabel}</span>
          {d.stale && <span className={`${styles.badge} ${f.warnBadge}`}>이전 전략 기준</span>}
          <span className={styles.muted}>전략 {d.strategyVersion.version !== null ? `${d.strategyVersion.version}번 버전` : "버전 확인 불가"} 기준</span>
        </p>

        {d.archived && (
          <p className={styles.notice} role="note">
            보관한 초안입니다. 복사·내보내기만 할 수 있고, 고치기·게시 기록 추가·기록 취소는 할 수 없습니다.
          </p>
        )}
        {d.stale && (
          <div className={`${styles.notice} ${f.warnBox}`} role="note">
            <p className={f.keep}>
              <strong>이전 전략 기준:</strong> 지금 승인본{approvedVersion !== null ? `(${approvedVersion}번 버전)` : ""}보다 앞선 전략으로 만든 초안입니다. 대상·메시지가 지금 전략과 맞는지 확인해 주세요. 맞추지 않아도 고치고 복사할 수 있습니다.
            </p>
            {editable && (
              <ActionForm action={rebaseChannelDraftAction} submitLabel="지금 승인본 기준으로 맞추기" pendingLabel="맞추는 중…" variant="secondary" className={f.inlineForm}>
                <input type="hidden" name="draftId" value={d.id} />
                <input type="hidden" name="revision" value={d.revision} />
              </ActionForm>
            )}
          </div>
        )}
        {d.briefChanged && (
          <p className={styles.muted} role="note">
            만든 뒤 브리프가 바뀌었습니다. 초안 내용은 그대로이니, 필요하면 아래 &lsquo;초안 고치기&rsquo;에서 직접 맞춰 주세요.
          </p>
        )}

        <details className={f.inlineDetails}>
          <summary>본문 보기</summary>
          {/* 미리 보기는 글자로만(HTML 로 그리지 않음) */}
          <pre className={`${styles.pre} ${cd.cdBodyText}`} tabIndex={0} aria-label={`${d.title} 본문`}>
            {d.body || "(본문 없음)"}
          </pre>
        </details>

        {editable && (
          <details className={f.inlineDetails}>
            <summary>초안 고치기</summary>
            <ChannelDraftEditForm key={d.revision} action={updateChannelDraftAction} draftId={d.id} revision={d.revision} initial={draftToForm(d)} />
          </details>
        )}

        <ChannelDraftExportPanel exp={d.export} title={d.title} />

        <section className={cd.cdPanel} aria-labelledby={`${headingId}-pubs`}>
          <h4 id={`${headingId}-pubs`} className={cd.cdPanelTitle}>
            게시 기록
            <span className={styles.badge}>
              취소 안 된 기록 {activePubs}/{CHANNEL_DRAFT_LIMITS.publicationsPerDraft}
            </span>
          </h4>
          <p className={`${styles.muted} ${f.keep}`}>
            티스토리에 직접 올린 뒤 주소와 시각을 남겨 두는 기록입니다. 기록은 고치거나 지울 수 없고 취소만 할 수 있습니다. 취소하지 않은 기록이 있으면 &lsquo;게시 기록됨&rsquo;이 붙습니다.
          </p>
          {editable &&
            (pubFull ? (
              <p className={styles.muted} role="note">
                취소하지 않은 게시 기록이 {CHANNEL_DRAFT_LIMITS.publicationsPerDraft}개라 더 남길 수 없습니다. 잘못 남긴 기록을 취소해 주세요.
              </p>
            ) : (
              <details className={f.inlineDetails}>
                <summary>+ 게시 기록 남기기</summary>
                <ActionForm key={rows.length} action={recordChannelPublicationAction} submitLabel="게시 기록 남기기" pendingLabel="남기는 중…" className={f.form}>
                  <input type="hidden" name="draftId" value={d.id} />
                  <div className={styles.field}>
                    <label htmlFor={`${headingId}-url`}>게시 주소 (https:// 로 시작)</label>
                    <input id={`${headingId}-url`} name="url" type="url" inputMode="url" autoComplete="off" required aria-required="true" placeholder="https://example.tistory.com/123" />
                    <span className={styles.muted}>개인 도메인 블로그 주소도 남길 수 있습니다.</span>
                  </div>
                  <div className={styles.field}>
                    <label htmlFor={`${headingId}-at`}>게시 시각 (한국 시간)</label>
                    <input id={`${headingId}-at`} name="publishedAt" type="datetime-local" defaultValue={kstLocalNow()} required aria-required="true" />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor={`${headingId}-note`}>메모 (선택)</label>
                    <input id={`${headingId}-note`} name="note" placeholder="예: 1차 발행" />
                  </div>
                </ActionForm>
              </details>
            ))}

          {rows.length === 0 ? (
            <p className={styles.muted}>아직 게시 기록이 없습니다.</p>
          ) : (
            <ul className={cd.cdPubList} aria-label={`${d.title} 게시 기록 목록`}>
              {rows.map((p) => (
                <li key={p.id} className={`${cd.cdPub} ${p.voided ? cd.cdPubVoided : ""}`}>
                  <p className={cd.cdPubHead}>
                    <span>{p.voided ? <s>{formatKst(p.publishedAt)}</s> : formatKst(p.publishedAt)}</span>
                    {p.voided && <span className={styles.badge}>취소됨</span>}
                  </p>
                  <p className={cd.cdPubUrl}>
                    {p.url ? (
                      p.voided ? (
                        <s>{p.url}</s>
                      ) : (
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className={styles.touchLink}>
                          {p.url}
                          <span className={styles.srOnly}> (새 창)</span>
                        </a>
                      )
                    ) : (
                      <span className={styles.muted}>주소를 보일 수 없습니다.</span>
                    )}
                  </p>
                  {p.nonTistoryHost && !p.voided && <p className={`${styles.muted} ${cd.cdWarnText}`}>티스토리 주소가 맞는지 확인하세요(개인 도메인이면 그대로 두어도 됩니다).</p>}
                  {p.note && <p className={styles.muted}>메모: {p.note}</p>}
                  {p.voided && <p className={styles.muted}>취소 이유: {p.voidReason ?? "(없음)"}</p>}
                  {editable && !p.voided && (
                    <details className={f.inlineDetails}>
                      <summary>이 기록 취소</summary>
                      <ActionForm action={voidChannelPublicationAction} submitLabel="기록 취소" pendingLabel="취소하는 중…" variant="secondary" className={f.form}>
                        <input type="hidden" name="publicationId" value={p.id} />
                        <div className={styles.field}>
                          <label htmlFor={`${p.id}-reason`}>취소 이유 (필수)</label>
                          <input id={`${p.id}-reason`} name="reason" required aria-required="true" placeholder="예: 주소를 잘못 적음" />
                        </div>
                        <p className={styles.muted}>취소한 기록도 목록에 남습니다(취소선). 취소는 되돌릴 수 없습니다.</p>
                      </ActionForm>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {editable && (
          <ActionForm action={archiveChannelDraftAction} submitLabel="이 초안 보관" pendingLabel="보관 중…" variant="secondary" className={f.inlineForm}>
            <input type="hidden" name="draftId" value={d.id} />
            <input type="hidden" name="revision" value={d.revision} />
            <p className={styles.muted}>보관한 초안은 복사·내보내기만 됩니다. 지우지 않으며, 보관을 되돌릴 수는 없습니다.</p>
          </ActionForm>
        )}
      </article>
    </li>
  );
}

function Shell({ count, children }: { count?: string; children: ReactNode }) {
  return (
    <section className={`${styles.section} ${f.funnel} ${cd.cdSection}`} aria-labelledby="channel-drafts" id="channel-drafts-panel">
      <div className={cd.cdHead}>
        <h2 id="channel-drafts" className={`${styles.subtitle} ${cd.cdTitle}`}>
          티스토리 초안
          {count && <span className={styles.badge}>{count}</span>}
        </h2>
        <p className={cd.cdBadges}>
          <span className={styles.badge}>채널: {CHANNEL_DRAFT_CHANNEL_LABEL}</span>
          <span className={styles.badge}>언어: {CHANNEL_DRAFT_LANGUAGE_LABEL}</span>
        </p>
        <p className={`${styles.muted} ${f.keep}`}>이 브리프로 티스토리에 올릴 글 초안을 만들고, 복사·내보내기한 뒤 직접 올린 기록을 남깁니다. 자동으로 게시하지 않습니다.</p>
      </div>
      {children}
    </section>
  );
}
