"use client";

import { useId, useState } from "react";
import type { ChannelDraftExport } from "@/features/channel-draft/server";
import { copyHtmlSource, copyMessage, copyPlainText, copyRich, downloadExport, type CopyResult, type ExportKind } from "../../_components/rich-copy";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import cd from "./channel-draft.module.css";

/**
 * 채널 초안 복사·내보내기(P2G-UI-01). 서버가 만든 draft.export 만 쓴다(인계 5절).
 * - 미리 보기를 HTML 로 그리지 않는다: HTML 은 글 상자(textarea)에 글자로만 보인다(dangerouslySetInnerHTML 없음).
 * - 클릭 처리 안에서 바로 클립보드에 쓴다(rich-copy.ts). 실패하면 해당 글 상자를 펼치고 글을 선택해 Ctrl+C 를 안내한다.
 * - 「게시」·「티스토리로 보내기」 단추는 없다(R08).
 */
type Box = "html" | "text" | "info";

export function ChannelDraftExportPanel({ exp, title }: { exp: ChannelDraftExport; title: string }) {
  const id = useId();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [open, setOpen] = useState<Box | null>(null);

  const infoText = [
    `제목: ${exp.info.title}`,
    `태그: ${exp.info.tags || "(없음)"}`,
    `메타 설명: ${exp.info.metaDescription || "(없음)"}`,
    `대표 이미지 안내: ${exp.info.imageNote || "(없음)"}`,
    ...(exp.info.imagePlaceholders.length ? ["본문 이미지 자리:", ...exp.info.imagePlaceholders.map((p, i) => `${i + 1}. ${p}`)] : []),
  ].join("\n");

  function done(r: CopyResult, box: Box) {
    setMsg({ text: copyMessage(r), ok: r.ok });
    if (!r.ok) {
      setOpen(box);
      // 펼친 뒤 글을 선택해 둔다(직접 Ctrl+C)
      requestAnimationFrame(() => {
        const el = document.getElementById(`${id}-${box}`) as HTMLTextAreaElement | null;
        el?.focus();
        el?.select();
      });
    }
  }
  // 클릭 처리 안에서 바로 부른다(await 앞에 다른 기다림 없음)
  const onRich = () => void copyRich({ html: exp.html, text: exp.text }).then((r) => done(r, "html"));
  const onSource = () => void copyHtmlSource(exp.html).then((r) => done(r, "html"));
  const onText = () => void copyPlainText(exp.text).then((r) => done(r, "text"));
  const onInfo = (value: string) => () => void copyPlainText(value).then((r) => done(r, "info"));
  const onFile = (kind: ExportKind) => () => {
    const content = kind === "html" ? exp.html : kind === "md" ? exp.markdown : exp.text;
    const name = exp.fileNames[kind];
    const ok = downloadExport({ fileName: name, kind, content });
    setMsg(ok ? { text: `${name} 파일을 내려받았습니다.`, ok: true } : { text: "파일을 만들지 못했습니다. 아래 글 상자에서 직접 복사해 주세요.", ok: false });
  };

  return (
    <section className={cd.cdPanel} aria-labelledby={`${id}-h`}>
      <h4 id={`${id}-h`} className={cd.cdPanelTitle}>
        복사·파일 내보내기
      </h4>
      <p className={`${styles.muted} ${f.keep}`}>
        자동 게시는 하지 않습니다. 복사하거나 파일(.html·.md)로 내려받아 티스토리 편집기에 직접 붙여 넣어 주세요. 이미지는 본문의 [이미지: …] 자리에 티스토리에서 직접 올립니다.
      </p>
      <div className={cd.cdButtons} role="group" aria-label={`${title} 복사`}>
        <button type="button" className={`${styles.button} ${f.touch}`} onClick={onRich}>
          서식째 복사 (기본 모드)
        </button>
        <button type="button" className={`${styles.secondaryButton} ${f.touch}`} onClick={onSource}>
          HTML 소스 복사 (HTML 모드)
        </button>
        <button type="button" className={`${styles.secondaryButton} ${f.touch}`} onClick={onText}>
          글자만 복사
        </button>
      </div>
      <div className={cd.cdButtons} role="group" aria-label={`${title} 파일 내보내기`}>
        <button type="button" className={`${styles.secondaryButton} ${f.touch}`} onClick={onFile("html")}>
          .html 내려받기
        </button>
        <button type="button" className={`${styles.secondaryButton} ${f.touch}`} onClick={onFile("md")}>
          .md 내려받기
        </button>
      </div>
      <p role="status" aria-live="polite" className={msg ? (msg.ok ? styles.notice : styles.error) : cd.cdStatusEmpty}>
        {msg?.text}
      </p>

      <dl className={cd.cdInfo}>
        <InfoRow label="제목" value={exp.info.title} onCopy={onInfo(exp.info.title)} />
        <InfoRow label="태그" value={exp.info.tags} onCopy={onInfo(exp.info.tags)} />
        <InfoRow label="메타 설명" value={exp.info.metaDescription} onCopy={onInfo(exp.info.metaDescription)} />
        <InfoRow label="대표 이미지 안내" value={exp.info.imageNote} />
      </dl>
      {exp.info.imagePlaceholders.length > 0 && (
        <div>
          <p className={cd.cdInfoLabel}>본문 이미지 자리 {exp.info.imagePlaceholders.length}곳</p>
          <ol className={cd.cdPlaceholders}>
            {exp.info.imagePlaceholders.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ol>
        </div>
      )}

      <TextBox id={`${id}-html`} summary="HTML 소스 보기" label="복사할 HTML 소스" value={exp.html} open={open === "html"} onToggle={(o) => setOpen(o ? "html" : null)} />
      <TextBox id={`${id}-text`} summary="글자만 보기" label="복사할 글자" value={exp.text} open={open === "text"} onToggle={(o) => setOpen(o ? "text" : null)} />
      <TextBox id={`${id}-info`} summary="글 정보 모두 보기" label="복사할 글 정보" value={infoText} open={open === "info"} onToggle={(o) => setOpen(o ? "info" : null)} />
    </section>
  );
}

function InfoRow({ label, value, onCopy }: { label: string; value: string; onCopy?: () => void }) {
  return (
    <div className={cd.cdInfoRow}>
      <dt className={cd.cdInfoLabel}>{label}</dt>
      <dd className={value ? cd.cdInfoValue : `${cd.cdInfoValue} ${styles.muted}`}>{value || "비어 있음"}</dd>
      {onCopy && value && (
        <dd className={cd.cdInfoAction}>
          <button type="button" className={`${styles.secondaryButton} ${f.touch}`} onClick={onCopy} aria-label={`${label} 복사`}>
            복사
          </button>
        </dd>
      )}
    </div>
  );
}

function TextBox({
  id,
  summary,
  label,
  value,
  open,
  onToggle,
}: {
  id: string;
  summary: string;
  label: string;
  value: string;
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  return (
    <details className={f.inlineDetails} open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary>{summary}</summary>
      <label htmlFor={id} className={cd.cdInfoLabel}>
        {label}
      </label>
      <textarea id={id} className={cd.cdSourceBox} value={value} readOnly rows={8} />
    </details>
  );
}
