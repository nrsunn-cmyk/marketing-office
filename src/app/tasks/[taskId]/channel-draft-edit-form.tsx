"use client";

import { useId, useState } from "react";
import { CHANNEL_DRAFT_LIMITS, CHANNEL_DRAFT_STATUSES, charLength, type ChannelDraftStatus } from "@/domain/channel-draft/constants";
import { ActionForm } from "../../_components/action-form";
import type { FormState } from "../../_components/form-state";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import cd from "./channel-draft.module.css";
import { checkTags, type ChannelDraftFormValue } from "./channel-draft-form";

/**
 * 채널 초안 고치기 폼(P2G-UI-01, 시안 Design/P2-next-concepts/channel-draft.html R1).
 * 길이·개수는 자르지 않고 표시만 한다(서버가 판단). 자동 게시 단추는 없다(R08).
 */
export function ChannelDraftEditForm({
  action,
  draftId,
  revision,
  initial,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  draftId: string;
  revision: number;
  initial: ChannelDraftFormValue;
}) {
  const id = useId();
  const [v, setV] = useState<ChannelDraftFormValue>(initial);
  const set = <K extends keyof ChannelDraftFormValue>(k: K, value: ChannelDraftFormValue[K]) => setV((p) => ({ ...p, [k]: value }));
  const L = CHANNEL_DRAFT_LIMITS;
  const count = (text: string, max: number, recommended?: number) => {
    const n = charLength(text);
    return (
      <span className={n > max ? styles.error : styles.muted} aria-live="polite">
        {n.toLocaleString("ko-KR")}/{max.toLocaleString("ko-KR")}자{recommended && n > recommended && n <= max ? ` · 권장 ${recommended}자를 넘었습니다` : ""}
      </span>
    );
  };
  const tags = checkTags(v.tags);
  const tagProblem = tags.tooMany || tags.tooLong.length > 0 || tags.duplicate.length > 0;

  return (
    <ActionForm action={action} submitLabel="초안 저장" className={f.form}>
      <input type="hidden" name="draftId" value={draftId} />
      <input type="hidden" name="revision" value={revision} />

      <div className={styles.field}>
        <label htmlFor={`${id}-title`}>글 제목 (필수)</label>
        <input id={`${id}-title`} name="title" value={v.title} onChange={(e) => set("title", e.target.value)} required aria-required="true" />
        {count(v.title, L.title)}
      </div>

      <div className={styles.field}>
        <label htmlFor={`${id}-body`}>본문</label>
        <textarea id={`${id}-body`} name="body" value={v.body} onChange={(e) => set("body", e.target.value)} rows={14} className={cd.cdBodyInput} aria-describedby={`${id}-syntax`} />
        {count(v.body, L.body)}
        <p id={`${id}-syntax`} className={`${styles.muted} ${f.keep}`}>
          쓸 수 있는 서식: <code>##</code>·<code>###</code> 소제목, <code>-</code>·<code>1.</code> 목록, <code>&gt;</code> 인용, <code>| 표 |</code>, <code>**굵게**</code>, <code>*기울임*</code>, <code>[링크](https://…)</code>, <code>[이미지: 설명]</code>. <code># 제목</code>과 HTML 태그는 글자 그대로 나갑니다.
        </p>
      </div>

      <div className={styles.field}>
        <label htmlFor={`${id}-tags`}>태그 (쉼표로 구분)</label>
        <input id={`${id}-tags`} name="tags" value={v.tags} onChange={(e) => set("tags", e.target.value)} aria-describedby={`${id}-tags-hint`} />
        <span id={`${id}-tags-hint`} className={tagProblem ? styles.error : styles.muted} aria-live="polite">
          {tags.count}/{L.tags}개 · 태그마다 {L.tag}자까지
          {tags.tooLong.length > 0 && ` · ${L.tag}자를 넘는 태그가 있습니다`}
          {tags.duplicate.length > 0 && ` · 같은 태그가 있습니다: ${tags.duplicate.join(", ")}`}
        </span>
      </div>

      <div className={styles.field}>
        <label htmlFor={`${id}-image`}>대표 이미지 안내 (선택)</label>
        <textarea id={`${id}-image`} name="imageNote" value={v.imageNote} onChange={(e) => set("imageNote", e.target.value)} rows={2} placeholder="예: 1200×630 비교 도표를 티스토리에서 직접 올리기" />
        {count(v.imageNote, L.imageNote)}
      </div>

      <div className={styles.field}>
        <label htmlFor={`${id}-meta`}>메타 설명 (선택, 검색 결과에 보일 요약)</label>
        <textarea id={`${id}-meta`} name="metaDescription" value={v.metaDescription} onChange={(e) => set("metaDescription", e.target.value)} rows={3} />
        {count(v.metaDescription, L.metaDescription, L.metaDescriptionRecommended)}
      </div>

      <div className={styles.field}>
        <label htmlFor={`${id}-status`}>진행 상태</label>
        <select id={`${id}-status`} name="status" value={v.status} onChange={(e) => set("status", e.target.value as ChannelDraftStatus)}>
          {(Object.keys(CHANNEL_DRAFT_STATUSES) as ChannelDraftStatus[]).map((s) => (
            <option key={s} value={s}>
              {CHANNEL_DRAFT_STATUSES[s]}
            </option>
          ))}
        </select>
        <span className={styles.muted}>&lsquo;게시 기록됨&rsquo;은 고르는 값이 아니라, 아래에 게시 기록을 남기면 저절로 붙습니다.</span>
      </div>
    </ActionForm>
  );
}
