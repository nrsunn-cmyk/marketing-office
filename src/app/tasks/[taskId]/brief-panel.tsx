import Link from "next/link";
import type { ReactNode } from "react";
import { unstable_rethrow } from "next/navigation";
import { BRIEF_CHANNELS, BRIEF_STATUSES, CLAIM_KINDS } from "@/domain/brief";
import {
  addBriefClaimAction,
  archiveBriefClaimAction,
  archiveContentBriefAction,
  linkClaimSourceAction,
  rebaseContentBriefAction,
  unlinkClaimSourceAction,
  updateBriefClaimAction,
  updateContentBriefAction,
} from "@/features/brief/actions";
import { getContentBriefFor, type BriefDetail } from "@/features/brief/server";
import type { FunnelBoard } from "@/features/funnel/server";
import { ActionForm } from "../../_components/action-form";
import { CopyButton } from "../../_components/copy-button";
import styles from "../../ui.module.css";
import { listBriefCopyChoices } from "@/features/brief/ai-copy";
import { BriefAiCopy } from "./brief-ai-copy";
import { BriefEditForm } from "./brief-edit-form";
import { ChannelDraftSection } from "./channel-draft-section";
import { specToForm } from "./brief-form";
import { ClaimForm, SourceLinkForm } from "./claim-forms";
import { sourceChoiceGroups } from "./source-choices";
import f from "./funnel.module.css";

/**
 * P2F-FRONT-01 콘텐츠 제작 브리프(퍼널 카드 × 채널 1개). 시안: Design/P2-next-concepts/content-brief.html.
 * 서버: src/features/brief (P2F-BACKEND-01). 주장마다 근거를 연결하고, 근거가 없으면 [미확인 주장]으로 보인다.
 * 보관한 프로젝트·취소한 작업·보관한 브리프는 읽기 전용(서버도 거절한다). 자동 문구 생성 버튼은 없다(미결정).
 */
export async function BriefPanel({
  board,
  taskId,
  projectId,
  briefId,
  readOnly,
}: {
  board: FunnelBoard;
  taskId: string;
  /** 외부 출처 화면으로 가는 링크용(SOURCES-UI-01) */
  projectId?: string;
  briefId: string;
  readOnly: boolean;
}) {
  const back = `/tasks/${taskId}#funnel`;
  let detail: BriefDetail | null;
  try {
    detail = await getContentBriefFor(board, briefId);
  } catch (e) {
    unstable_rethrow(e);
    console.error("[brief]", e);
    return (
      <Shell>
        <p className={styles.error} role="alert">
          브리프를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
        <p className={styles.row}>
          <Link href={`/tasks/${taskId}?brief=${briefId}#brief`} className={`${styles.secondaryButton} ${f.touch}`}>
            다시 불러오기
          </Link>
          <Link href={back} className={`${styles.secondaryButton} ${f.touch}`}>
            퍼널 보드로
          </Link>
        </p>
      </Shell>
    );
  }
  if (!detail) {
    return (
      <Shell>
        <div className={styles.emptyState}>
          <strong>브리프를 찾을 수 없습니다.</strong>
          <p className={styles.muted}>지워졌거나 다른 퍼널의 브리프입니다. 퍼널 보드의 카드에서 다시 골라 주세요.</p>
          <p>
            <Link href={back} className={`${styles.secondaryButton} ${f.touch}`}>
              퍼널 보드로
            </Link>
          </p>
        </div>
      </Shell>
    );
  }

  const { brief, claims, warnings, options, markdown } = detail;
  // 보드에 없는 카드(보관한 카드)의 브리프는 서버가 모든 쓰기를 거절한다(assert_brief_open). 화면도 읽기 전용(P2F-FRONT-01-R1, QA D1)
  const cardArchived = !board.stages.some((st) => st.items.some((i) => i.id === brief.funnelItemId));
  const locked = readOnly || brief.archived || cardArchived;
  const unverified = warnings.find((w) => w.kind === "unverified");
  const groups = sourceChoiceGroups(options);
  const aiChoices = listBriefCopyChoices(); // 키 있는 공급자만(키 값은 돌려주지 않음, DEC-08-R1)
  const mdId = `brief-md-${brief.id}`;

  return (
    <>
    <Shell title={brief.title}>
      <div className={f.refBar}>
        <span className={styles.badge}>{BRIEF_CHANNELS[brief.channel]}</span>
        <span className={styles.muted}>퍼널 단계: {brief.stageLabel}</span>
        <span className={styles.badge}>{BRIEF_STATUSES[brief.status]}</span>
        {brief.stale && <span className={`${styles.badge} ${f.warnBadge}`}>브리프: 이전 전략 기준</span>}
        {brief.archived && <span className={styles.badge}>보관한 브리프</span>}
        {brief.copyOriginAi && <span className={`${styles.badge} ${f.warnBadge}`}>카피: AI 초안(검토 전)</span>}
        <Link href={back} className={f.inlineLink}>
          퍼널 보드로
        </Link>
      </div>

      {brief.archived && (
        <div className={styles.notice} role="note">
          보관한 브리프는 읽기만 할 수 있습니다.
        </div>
      )}
      {cardArchived && !brief.archived && (
        <div className={styles.notice} role="note">
          보관한 퍼널 카드의 브리프는 읽기만 할 수 있습니다. 주장·근거·내용을 고치려면 보드에 있는 카드에서 새 브리프를 만들어 주세요.
        </div>
      )}
      {brief.stale && (
        <div className={`${styles.notice} ${f.warnBox}`} role="note">
          <p className={f.keep}>
            <strong>이 브리프는 이전 전략 기준입니다.</strong> 이 브리프만 지금 승인한 전략으로 다시 맞출 수 있습니다. 퍼널 보드의 기준 맞추기와는 따로 동작합니다(보드를 맞춰도 브리프는 그대로입니다). 회사 프로필 근거가 새 전략의 프로필 버전과 다르면 그 근거를 먼저 해제해야 합니다.
          </p>
          {!locked && (
            <ActionForm action={rebaseContentBriefAction} submitLabel="이 브리프만 지금 승인본 기준으로 맞추기" pendingLabel="맞추는 중…" variant="secondary" className={f.inlineForm}>
              <input type="hidden" name="briefId" value={brief.id} />
              <input type="hidden" name="revision" value={brief.revision} />
            </ActionForm>
          )}
        </div>
      )}
      {warnings.some((w) => w.kind === "empty") && (
        <div className={styles.emptyState}>
          <strong>아직 비어 있는 브리프입니다.</strong>
          <p className={styles.muted}>훅·핵심 요지를 적고, 콘텐츠에서 사실처럼 말할 주장을 더한 뒤 근거를 연결해 주세요.</p>
        </div>
      )}
      {unverified && unverified.kind === "unverified" && (
        <div className={`${styles.notice} ${f.warnBox}`} role="note">
          <p className={f.keep}>
            <strong>미확인 주장 {unverified.claimIds.length}개:</strong> 근거가 연결되지 않은 주장은 복사한 글에 [미확인 주장]으로 표시됩니다. 쓰기 전에 근거를 연결하거나 문장을 고쳐 주세요.
          </p>
        </div>
      )}

      <dl className={f.briefFacts}>
        <Fact label="타깃 독자" value={brief.audience} />
        <Fact label="훅 문장" value={brief.hook} />
        <Fact label="핵심 요지" value={brief.coreMessage} />
        <Fact label="CTA" value={brief.cta} />
      </dl>

      <section aria-labelledby="brief-claims" className={f.claimsBox}>
        <h3 id="brief-claims" className={f.colTitle}>
          주장과 근거
          <span className={styles.badge}>{claims.length}개</span>
        </h3>
        {projectId && !locked && (
          <p className={styles.muted}>
            통계·기사 같은 외부 근거는{" "}
            <Link href={`/projects/${projectId}/sources`} className={styles.touchLink}>
              외부 출처 화면
            </Link>
            에서 먼저 추가하면 &lsquo;근거 연결하기&rsquo;에서 고를 수 있습니다.
          </p>
        )}
        {claims.length === 0 ? (
          <p className={styles.muted}>아직 주장이 없습니다.</p>
        ) : (
          <ol className={f.cards} aria-label="주장 목록">
            {claims.map((c, i) => {
              const ok = c.sourceRows.length > 0;
              return (
                <li key={c.id} className={`${f.card} ${ok ? "" : f.claimUnverified}`}>
                  <div className={f.cardFoot}>
                    <span>
                      주장 {i + 1} ({CLAIM_KINDS[c.kind]})
                    </span>
                    <span className={`${f.tag} ${ok ? f.tag_cta : f.tag_warn}`}>{ok ? "✓ 근거 연결됨" : "[미확인 주장]"}</span>
                  </div>
                  <p className={f.claimText}>{c.text}</p>
                  {ok && (
                    <ul className={f.sourceList} aria-label={`주장 ${i + 1} 근거`}>
                      {c.sourceRows.map((s) => (
                        <li key={s.id} className={f.sourceRow}>
                          <span>
                            근거: {s.label}
                            {s.note && <span className={styles.muted}> · {s.note}</span>}
                          </span>
                          {!locked && (
                            <ActionForm action={unlinkClaimSourceAction} submitLabel="근거 해제" pendingLabel="해제 중…" variant="secondary" className={f.inlineForm}>
                              <input type="hidden" name="sourceId" value={s.id} />
                            </ActionForm>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {!locked && (
                    <>
                      <details className={f.inlineDetails}>
                        <summary>근거 연결하기</summary>
                        <SourceLinkForm key={c.sourceRows.length} action={linkClaimSourceAction} claimId={c.id} groups={groups} />
                      </details>
                      <details className={f.inlineDetails}>
                        <summary>주장 고치기·보관</summary>
                        <ClaimForm key={c.revision} action={updateBriefClaimAction} hidden={{ claimId: c.id, revision: c.revision }} initialText={c.text} initialKind={c.kind} submitLabel="주장 저장" />
                        <ActionForm action={archiveBriefClaimAction} submitLabel="이 주장 보관" pendingLabel="보관 중…" variant="secondary" className={f.inlineForm}>
                          <input type="hidden" name="claimId" value={c.id} />
                          <input type="hidden" name="revision" value={c.revision} />
                        </ActionForm>
                      </details>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {!locked && (
          <details className={f.inlineDetails}>
            <summary>+ 주장 추가</summary>
            <ClaimForm key={claims.length} action={addBriefClaimAction} hidden={{ briefId: brief.id }} submitLabel="주장 추가" />
          </details>
        )}
      </section>

      <section aria-labelledby="brief-copy" className={f.claimsBox}>
        <h3 id="brief-copy" className={f.colTitle}>
          복사용 마크다운
        </h3>
        <p className={`${styles.muted} ${f.keep}`}>다른 도구에 붙여 넣을 수 있는 글입니다. 근거가 없는 주장에는 [미확인 주장]이 붙습니다.</p>
        <CopyButton targetId={mdId} label="마크다운 복사" />
        <details className={f.inlineDetails}>
          <summary>복사할 내용 보기</summary>
          <pre id={mdId} className={`${styles.pre} ${f.mdBox}`} tabIndex={0} aria-label="복사할 마크다운">
            {markdown}
          </pre>
        </details>
      </section>

      {/* DEC08-UI-01: 키가 있는 공급자가 하나도 없으면(선택지 0개) 이 영역을 그리지 않는다. revision 이 바뀌면(채택·저장) 새로 시작 */}
      {!locked && aiChoices.length > 0 && <BriefAiCopy key={brief.revision} taskId={taskId} briefId={brief.id} revision={brief.revision} choices={aiChoices} />}

      {!locked && (
        <>
          <details className={f.basis}>
            <summary>브리프 고치기</summary>
            <BriefEditForm
              key={brief.revision}
              action={updateContentBriefAction}
              briefId={brief.id}
              revision={brief.revision}
              channel={brief.channel}
              copyAi={brief.copyOriginAi}
              initial={{
                title: brief.title,
                audience: brief.audience ?? "",
                hook: brief.hook ?? "",
                coreMessage: brief.coreMessage ?? "",
                cta: brief.cta ?? "",
                spec: specToForm(brief.channel, brief.channelSpec),
                copyDraft: brief.copyDraft ?? "",
                copyOrigin: brief.copyOrigin,
                imageGuide: brief.imageGuide ?? "",
                status: brief.status,
              }}
            />
          </details>
          <ActionForm action={archiveContentBriefAction} submitLabel="이 브리프 보관" pendingLabel="보관 중…" variant="secondary" className={f.inlineForm}>
            <input type="hidden" name="briefId" value={brief.id} />
            <input type="hidden" name="revision" value={brief.revision} />
            <p className={styles.muted}>보관한 브리프는 목록에서 빠집니다(지우지 않음, 되돌리기는 아직 없습니다).</p>
          </ActionForm>
        </>
      )}
    </Shell>
    {/* P2G-UI-01: 브리프 바로 아래 티스토리 초안. 읽기 전용은 프로젝트 보관·작업 취소만 따른다(브리프·카드 보관은 새로 만들기만 막음, 서버와 같음) */}
    <ChannelDraftSection board={board} detail={detail} readOnly={readOnly} taskId={taskId} projectId={projectId} />
    </>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={value ? undefined : styles.muted}>{value ?? "비어 있음"}</dd>
    </div>
  );
}

function Shell({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className={`${styles.section} ${f.funnel}`} aria-labelledby="brief" id="brief-panel">
      <h2 id="brief" className={`${styles.subtitle} ${f.briefTitle}`}>
        콘텐츠 브리프{title ? `: ${title}` : ""}
      </h2>
      {children}
    </section>
  );
}
