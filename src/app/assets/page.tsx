import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ASSET_KIND_LABELS, EXTRACTION_STATUS_LABELS, UPLOAD_STATUS_LABELS } from "@/domain/state/labels";
import { ASSET_KINDS, listLibrary, type AssetKind } from "@/features/library/server";
import { AppNav } from "../_components/app-nav";
import styles from "../ui.module.css";

export const metadata: Metadata = { title: "자료실 · 마케팅 업무실" };

/** 자료실 (S05 모아 보기): 모든 고객·프로젝트의 파일·링크·메모. 자료 추가는 각 고객·프로젝트 화면에서 한다. */
export default function LibraryPage({ searchParams }: PageProps<"/assets">) {
  return (
    <>
      <AppNav />
      <main className={`${styles.page} ${styles.wide}`}>
        <h1 className={styles.title}>자료실</h1>
        <p className={styles.muted}>모든 고객·프로젝트의 자료를 모아 봅니다. 자료 추가는 고객이나 프로젝트 화면에서 합니다.</p>
        <Suspense fallback={<p className={styles.muted}>불러오는 중…</p>}>
          <Library searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

function formatBytes(n: number | null): string {
  if (n == null) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

async function Library({ searchParams }: { searchParams: PageProps<"/assets">["searchParams"] }) {
  const params = await searchParams;
  const kind = (ASSET_KINDS as readonly string[]).includes(String(params.kind)) ? (params.kind as AssetKind) : null;
  const q = typeof params.q === "string" ? params.q : "";
  const items = await listLibrary({ kind, q });

  return (
    <section className={styles.section} aria-labelledby="library-list">
      <h2 id="library-list" className={styles.subtitle}>
        자료 목록
      </h2>
      <form className={styles.row} role="search" aria-label="자료 찾기">
        <label htmlFor="library-kind" className={styles.muted}>
          종류
        </label>
        <select id="library-kind" name="kind" defaultValue={kind ?? ""}>
          <option value="">전체</option>
          {ASSET_KINDS.map((k) => (
            <option key={k} value={k}>
              {ASSET_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <label htmlFor="library-q" className={styles.muted}>
          이름
        </label>
        <input id="library-q" name="q" defaultValue={q} />
        <button type="submit" className={styles.secondaryButton}>
          찾기
        </button>
      </form>
      {items.length === 0 ? (
        <p className={styles.muted}>{kind || q ? "조건에 맞는 자료가 없습니다." : "아직 등록한 자료가 없습니다."}</p>
      ) : (
        <ul className={styles.list} aria-label="자료실 목록">
          {items.map((a) => (
            <li key={a.id} className={styles.listItem}>
              <div>
                <span className={styles.badge}>{ASSET_KIND_LABELS[a.kind]}</span>{" "}
                <strong>
                  {a.file_name ??
                    (a.kind === "url" ? a.url : `${(a.text_content ?? "").slice(0, 40)}${(a.text_content ?? "").length > 40 ? "…" : ""}`)}
                </strong>
                <div className={styles.muted}>
                  {a.client_id && <Link href={`/clients/${a.client_id}`}>{a.client_name}</Link>}
                  {a.project_id && (
                    <>
                      {" · "}
                      <Link href={`/projects/${a.project_id}`}>{a.project_title}</Link>
                    </>
                  )}
                  {a.kind === "file" && ` · ${a.mime ?? ""} ${formatBytes(a.bytes)} · ${EXTRACTION_STATUS_LABELS[a.extraction_status]}`}
                </div>
              </div>
              <div className={styles.row}>
                <span className={styles.badge}>{UPLOAD_STATUS_LABELS[a.upload_status] ?? a.upload_status}</span>
                {a.kind === "file" && a.upload_status === "stored" && <a href={`/assets/${a.id}/download`}>내려받기</a>}
                {a.kind === "url" && a.url && (
                  <a href={a.url} target="_blank" rel="noopener noreferrer nofollow">
                    열기
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {items.length === 200 && <p className={styles.muted}>최근 200개까지 보여 줍니다. 종류나 이름으로 좁혀 보세요.</p>}
    </section>
  );
}
