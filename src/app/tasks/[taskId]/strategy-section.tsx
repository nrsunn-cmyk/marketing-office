import { randomUUID } from "node:crypto";
import { emptyStrategyForm } from "@/contracts/p2-strategy-form";
import { GENERATOR_LABELS } from "@/domain/state/labels";
import { rebuildStrategyInput, strategyInputToForm, strategyViewFromContent, type SectionView, type StrategyView } from "@/domain/strategy";
import { generateStrategyAction, saveStrategyEditAction } from "@/features/strategy/actions";
import { getStrategyContext, type AssetOption, type ProfileOption } from "@/features/strategy/server";
import { decideAction } from "@/features/tasks/actions";
import type { TaskDetail, VersionInfo } from "@/features/tasks/server";
import { ActionForm } from "../../_components/action-form";
import { formatDateTimeIn } from "../../_components/format-time";
import styles from "../../ui.module.css";
import { SkipToResult, StrategyJsonCopy } from "./strategy-actions";
import { StrategyEditor } from "./strategy-editor";
import s from "./strategy.module.css";

/** P2-c 전략 작업 화면: 만들기(왼쪽)·결과(오른쪽)·직접 고치기·검토 */
export async function StrategySection({
  detail,
  shown,
  isCurrent,
  timeZone,
}: {
  detail: TaskDetail;
  shown: VersionInfo | null;
  isCurrent: boolean;
  timeZone: string;
}) {
  const ctx = await getStrategyContext(detail);
  if (!ctx.project.clientId) {
    return (
      <section className={styles.section}>
        <p className={styles.error} role="alert">
          전략은 지금 고객 프로젝트에서만 만들 수 있습니다. 자체 브랜드·개인 프로젝트의 회사 프로필 방식은 준비 중입니다.
        </p>
      </section>
    );
  }
  const firstApproved = ctx.profiles.find((p) => p.status === "approved")?.id ?? "";
  return (
    <>
    {/* 결과가 있을 때만: 긴 입력 폼 앞에서 결과로 바로 간다(DOM·탭 순서 = 화면 순서) */}
    {shown && <SkipToResult />}
    <div className={styles.grid2}>
      <section className={styles.section} aria-labelledby="strategy-input">
        <h2 id="strategy-input" className={styles.subtitle}>
          전략 입력
        </h2>
        <p className={styles.muted}>
          사실에는 출처를 하나씩 고릅니다. 출처가 없으면 추정으로 적어 주세요. 입력한 내용만 정리하며, 점수나 숫자를 새로 만들지 않습니다.
        </p>
        <StrategyEditor
          mode="generate"
          action={generateStrategyAction}
          hidden={{ taskId: detail.task.id, idempotencyKey: randomUUID() }}
          initial={emptyStrategyForm(firstApproved)}
          profiles={ctx.profiles}
          assets={ctx.assets}
        />
      </section>
      <div>
        {shown ? (
          <StrategyResult detail={detail} version={shown} isCurrent={isCurrent} timeZone={timeZone} profiles={ctx.profiles} assets={ctx.assets} project={ctx.project} />
        ) : (
          <section className={styles.section}>
            <h2 className={styles.subtitle}>결과</h2>
            <p className={styles.muted}>아직 만든 전략이 없습니다. &lsquo;전략 입력&rsquo; 칸에서 승인된 프로필 버전을 고르고 &lsquo;전략 초안 만들기&rsquo;를 눌러 주세요.</p>
          </section>
        )}
      </div>
    </div>
    </>
  );
}

function StrategyResult({
  detail,
  version,
  isCurrent,
  timeZone,
  profiles,
  assets,
  project,
}: {
  detail: TaskDetail;
  version: VersionInfo;
  isCurrent: boolean;
  timeZone: string;
  profiles: ProfileOption[];
  assets: AssetOption[];
  project: Awaited<ReturnType<typeof getStrategyContext>>["project"];
}) {
  // 저장된 상태·질문은 믿지 않고 사실·추정에서 다시 계산한다(N1)
  const view = strategyViewFromContent(version.content, project);
  const ref = (version.content as unknown as { profileRef?: { id?: string; version?: number } }).profileRef;
  const refProfile = profiles.find((p) => p.id === ref?.id);
  const approved = detail.artifact?.approved_version_id === version.id;
  const input = rebuildStrategyInput(version.content, project);

  return (
    <section className={styles.section} aria-labelledby="strategy-result">
      <div className={styles.header}>
        <h2 id="strategy-result" className={`${styles.subtitle} ${s.resultTarget}`} tabIndex={-1}>
          전략 {version.version}번 버전
        </h2>
        <span className={styles.row}>
          {approved && <span className={styles.badge}>승인본</span>}
          {isCurrent ? <span className={styles.badge}>현재 초안</span> : <span className={styles.badge}>이전 버전 보기</span>}
        </span>
      </div>
      <p className={styles.muted}>
        {GENERATOR_LABELS[version.generator] ?? version.generator} · {formatDateTimeIn(version.created_at, timeZone)}
        {view.kind === "draft" && ` · ${view.profileLabel}`}
      </p>
      {refProfile && refProfile.status !== "approved" && (
        // N2: 정책 미정. 동작은 바꾸지 않고 경계만 보인다
        <p className={styles.error} role="note">
          이 전략이 기준으로 삼은 회사 프로필 {refProfile.version}번 버전은 지금 &lsquo;{refProfile.status === "revoked" ? "승인 철회됨" : "승인 안 됨"}&rsquo; 상태입니다.
          이 경우 전략을 승인해도 되는지는 아직 정하지 않았습니다(관리자 결정 대기).
        </p>
      )}

      {input && <StrategyJsonCopy json={JSON.stringify(input, null, 2)} versionLabel={`전략 ${version.version}번 버전`} />}

      <StrategyViewBlock view={view} assets={assets} />

      {isCurrent && detail.artifact && view.kind === "draft" && ref?.id && (
        <>
          <details>
            <summary>직접 고치기 (새 버전으로 저장)</summary>
            <StrategyEditor
              mode="edit"
              action={saveStrategyEditAction}
              hidden={{ taskId: detail.task.id, artifactId: detail.artifact.id, revision: detail.artifact.revision }}
              initial={strategyInputToForm(input, ref.id)}
              profiles={profiles}
              assets={assets}
            />
          </details>
          {!approved && (
            <div className={styles.section} aria-label="검토 결정">
              <h3>검토</h3>
              <ActionForm action={decideAction} submitLabel="이 버전 승인">
                <input type="hidden" name="artifactId" value={detail.artifact.id} />
                <input type="hidden" name="versionId" value={version.id} />
                <input type="hidden" name="decision" value="approved" />
              </ActionForm>
              <ActionForm action={decideAction} submitLabel="수정 요청" variant="secondary">
                <input type="hidden" name="artifactId" value={detail.artifact.id} />
                <input type="hidden" name="versionId" value={version.id} />
                <input type="hidden" name="decision" value="changes_requested" />
                <div className={styles.field}>
                  <label htmlFor="strategy-decide-comment">수정할 점 (선택)</label>
                  <textarea id="strategy-decide-comment" name="comment" />
                </div>
              </ActionForm>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** toStrategyView 결과를 텍스트로만 그린다(HTML 조합 없음) */
function StrategyViewBlock({ view, assets }: { view: StrategyView; assets: AssetOption[] }) {
  if (view.kind === "invalid") {
    return (
      <div className={styles.error} role="alert">
        {view.summaryErrors.map((m) => (
          <p key={m}>{m}</p>
        ))}
        {Object.entries(view.fieldErrors).map(([sec, msgs]) => (msgs ?? []).map((m) => <p key={`${sec}-${m}`}>{m}</p>))}
      </div>
    );
  }
  const assetLabel = new Map(assets.map((a) => [a.id, a.label]));
  return (
    <>
      {view.questions.length > 0 && (
        <div className={styles.notice} role="note">
          <strong>확인할 질문</strong>
          <ul>
            {view.questions.map((q) => (
              <li key={q.id}>
                [{q.sectionLabel}] {q.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className={s.cards}>
        {view.sections.map((sec) => (
          <SectionCard key={sec.key} sec={sec} assetLabel={assetLabel} />
        ))}
      </div>
      {view.userUnknowns.length > 0 && (
        <div className={s.card}>
          <h3 className={s.cardTitle}>아직 모르는 것</h3>
          <ul>
            {view.userUnknowns.map((u) => (
              <li key={u.id} className={s.entry}>
                <span className={s.kindTag}>[미확인]</span>
                {u.topic}
                {u.question && <span className={s.sourceLine}>{u.question}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function SectionCard({ sec, assetLabel }: { sec: SectionView; assetLabel: Map<string, string> }) {
  return (
    <article className={s.card} aria-label={sec.label}>
      <div className={s.cardHead}>
        <h3 className={s.cardTitle}>
          {sec.label}
          {sec.required && <span className={styles.muted}> · 필수</span>}
        </h3>
        <span className={s.tone} data-tone={sec.badge.tone}>
          {sec.badge.label}
        </span>
      </div>
      {sec.facts.length === 0 && sec.inferences.length === 0 && <p className={styles.muted}>입력한 내용이 없습니다.</p>}
      <ul>
        {sec.facts.map((f) => (
          <li key={f.id} className={s.entry}>
            <span className={s.kindTag}>[사실]</span>
            {f.text}
            {f.sources.map((src, i) => (
              <span key={i} className={s.sourceLine}>
                출처: {src.kind === "asset" ? `${src.label} · ${assetLabel.get(src.ref) ?? "자료"}` : src.kind === "url" ? `${src.label} · ${src.ref}` : src.label}
              </span>
            ))}
          </li>
        ))}
        {sec.inferences.map((i) => (
          <li key={i.id} className={s.entry}>
            <span className={s.kindTag}>[추정·가설]</span>
            {i.text}
            {i.rationale && <span className={s.sourceLine}>근거: {i.rationale}</span>}
          </li>
        ))}
      </ul>
    </article>
  );
}
