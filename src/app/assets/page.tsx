import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { ASSET_KIND_LABELS, EXTRACTION_STATUS_LABELS, UPLOAD_STATUS_LABELS } from "@/domain/state/labels";
import { decodeCursor, parsePage } from "@/domain/paging";
import { ASSET_KINDS, listLibrary, type AssetKind } from "@/features/library/server";
import { AppNav } from "../_components/app-nav";
import { Pager } from "../_components/pager";
import styles from "../ui.module.css";

export const metadata: Metadata = { title: "자료실 · 마케팅 업무실" };

/** 자료실 (S05 모아 보기): 모든 고객·프로젝트의 파일·링크·메모. 자료 추가는 각 고객·프로젝트 화면에서 한다. */
export default function LibraryPage({ searchParams }: PageProps<"/assets">) {
  return (
    <>
      <AppNav />
      <main className={`${styles.page} ${styles.wide} ${styles.touchPage}`}>
        <h1 className={styles.title}>자료실</h1>
        <p className={styles.muted}>모든 고객·프로젝트의 자료를 모아 봅니다. 자료 추가는 고객이나 프로젝트 화면에서 합니다.</p>
        <Suspense
          fallback={
            <p className={styles.muted} role="status">
              자료 목록을 불러오는 중…
            </p>
          }
        >
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

/** 자료 목록 (UI-RESP-04): 빈 상태·불러오는 중·오류를 목록 화면(UI-RESP-03)과 같은 구조로, 긴 이름은 한 줄 말줄임 + title */
async function Library({ searchParams }: { searchParams: PageProps<"/assets">["searchParams"] }) {
  const params = await searchParams;
  const kind = (ASSET_KINDS as readonly string[]).includes(String(params.kind)) ? (params.kind as AssetKind) : null;
  const q = typeof params.q === "string" ? params.q : "";
  const cursor = decodeCursor(typeof params.cursor === "string" ? params.cursor : null);
  const page = cursor ? parsePage(params.page) : 1;
  let result: Awaited<ReturnType<typeof listLibrary>>;
  try {
    result = await listLibrary({ kind, q, cursor });
  } catch (e) {
    unstable_rethrow(e); // 로그인·업무실 확인의 이동(redirect)은 그대로 통과시킨다
    console.error("[assets]", e);
    return (
      <section className={styles.section} aria-label="자료 목록 상태">
        <p className={styles.error} role="alert">
          자료 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
        <p>
          <Link href="/assets" className={`${styles.secondaryButton} ${styles.touchTarget}`}>
            다시 불러오기
          </Link>
        </p>
      </section>
    );
  }
  const { items, total, nextCursor } = result;

  return (
    <section className={styles.section} aria-labelledby="library-list">
      <h2 id="library-list" className={styles.subtitle}>
        자료 목록
      </h2>
      <form className={`${styles.row} ${styles.searchForm}`} role="search" aria-label="자료 찾기">
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
        kind || q ? (
          <div className={styles.emptyState}>
            <strong>조건에 맞는 자료가 없습니다.</strong>
            <p className={styles.muted}>종류를 &lsquo;전체&rsquo;로 바꾸거나 다른 이름으로 찾아 보세요.</p>
            <p className={styles.row}>
              <Link href="/assets" className={styles.secondaryButton}>
                조건 지우기
              </Link>
            </p>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <strong>아직 등록한 자료가 없습니다.</strong>
            <p className={styles.muted}>파일·링크·메모는 고객이나 프로젝트 화면의 자료 칸에서 추가합니다.</p>
            <p className={styles.row}>
              <Link href="/clients" className={styles.button}>
                고객 화면으로
              </Link>
              <Link href="/projects" className={styles.secondaryButton}>
                프로젝트 화면으로
              </Link>
            </p>
          </div>
        )
      ) : (
        <ul className={styles.list} aria-label="자료실 목록">
          {items.map((a) => {
            const name = a.display_name ?? "";
            const fileInfo =
              a.kind === "file" ? [a.mime ?? "", formatBytes(a.bytes), EXTRACTION_STATUS_LABELS[a.extraction_status] ?? a.extraction_status].filter(Boolean).join(" · ") : "";
            return (
              <li key={a.id} className={styles.listItem}>
                <span className={styles.rowMainGrow}>
                  <span className={styles.metaRow}>
                    <span className={styles.badge}>{ASSET_KIND_LABELS[a.kind]}</span>
                    <strong className={styles.rowTitle} title={name}>
                      {name}
                    </strong>
                  </span>
                  <span className={`${styles.muted} ${styles.metaRow}`}>
                    {a.client_id && (
                      <Link href={`/clients/${a.client_id}`} className={styles.metaLink} title={a.client_name ?? undefined}>
                        {a.client_name}
                      </Link>
                    )}
                    {a.project_id && (
                      <Link href={`/projects/${a.project_id}`} className={styles.metaLink} title={a.project_title ?? undefined}>
                        {a.project_title}
                      </Link>
                    )}
                    {fileInfo && (
                      <span className={styles.metaLink} title={fileInfo}>
                        {fileInfo}
                      </span>
                    )}
                  </span>
                </span>
                <span className={styles.rowActions}>
                  <span className={styles.badge}>{UPLOAD_STATUS_LABELS[a.upload_status] ?? a.upload_status}</span>
                  {a.kind === "file" && a.upload_status === "stored" && (
                    <a href={`/assets/${a.id}/download`} className={styles.touchLink}>
                      내려받기
                    </a>
                  )}
                  {a.kind === "url" && a.url && (
                    <a href={a.url} target="_blank" rel="noopener noreferrer nofollow" className={styles.touchLink}>
                      열기
                    </a>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {total > 0 && (
        <Pager
          basePath="/assets"
          params={{ kind, q: q || null }}
          total={total}
          page={page}
          shown={items.length}
          nextCursor={nextCursor}
          label="자료실"
        />
      )}
    </section>
  );
}
