import type { Metadata } from "next";
import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { BRIEF_CHANNELS } from "@/domain/brief/constants";
import { RESEARCH_SOURCE_LIMITS, type ResearchReviewStatus } from "@/domain/research-source/input";
import { getProject } from "@/features/projects/server";
import { addResearchSourceAction, setResearchSourceReviewAction } from "@/features/research-sources/actions";
import {
  listResearchSourceCitations,
  listResearchSources,
  type ResearchSourceCitation,
  type ResearchSourceSummary,
} from "@/features/research-sources/server";
import { ActionForm } from "../../../_components/action-form";
import { AppNav } from "../../../_components/app-nav";
import { MobileActionSheet } from "../../../_components/mobile-action-sheet";
import styles from "../../../ui.module.css";
import s from "./sources.module.css";

export const metadata: Metadata = { title: "외부 출처 · 마케팅 업무실" };

/**
 * 외부 출처 관리 기본형(SOURCES-UI-01, 주인님 DEC-10 ①).
 * 할 수 있는 일: 목록·추가·검토 상태 바꾸기·이 출처를 인용한 브리프 보기(브리프 화면으로 이동).
 * 수정·보관은 DB가 지원하지 않아 넣지 않는다(주소·확인 날짜는 바꿀 수 없는 값).
 * 자동 수집·자동 검증은 없다. 사람이 원문을 열어 보고 '확인함'으로 바꾼다.
 */
export default function ProjectSourcesPage({ params, searchParams }: PageProps<"/projects/[projectId]/sources">) {
  return (
    <>
      <AppNav />
      <main className={`${styles.page} ${styles.wide} ${styles.touchPage}`}>
        <Suspense
          fallback={
            <p className={styles.muted} role="status">
              외부 출처를 불러오는 중…
            </p>
          }
        >
          <SourcesView params={params} searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

const REVIEW_LABELS: Record<ResearchReviewStatus, string> = { verified: "확인함", unverified: "확인 전" };
const FILTERS = [
  { key: "all", label: "전체" },
  { key: "unverified", label: "확인 전" },
  { key: "verified", label: "확인함" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

/** 한국 날짜(YYYY-MM-DD). 확인 날짜 칸의 기본값·최댓값 */
function todayKst(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
/** 저장된 확인 시각을 한국 날짜로 */
function kstDate(iso: string): string {
  return todayKst(new Date(iso));
}
/** 목록에 보일 주소: 프로토콜을 뺀 짧은 형태(전체 주소는 title) */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

async function SourcesView({
  params,
  searchParams,
}: {
  params: PageProps<"/projects/[projectId]/sources">["params"];
  searchParams: PageProps<"/projects/[projectId]/sources">["searchParams"];
}) {
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) notFound();
  const project = await getProject(projectId);
  if (!project) notFound();
  const sp = await searchParams;
  const filter: FilterKey = FILTERS.some((f) => f.key === sp.status) ? (sp.status as FilterKey) : "all";
  const base = `/projects/${project.id}/sources`;

  let sources: ResearchSourceSummary[];
  try {
    sources = await listResearchSources(project.id);
  } catch (e) {
    unstable_rethrow(e);
    console.error("[project sources]", e);
    return (
      <>
        <Header projectId={project.id} title={project.title} />
        <section className={styles.section} aria-label="외부 출처 상태">
          <p className={styles.error} role="alert">
            외부 출처를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
          </p>
          <p>
            <Link href={base} className={`${styles.secondaryButton} ${styles.touchTarget}`}>
              다시 불러오기
            </Link>
          </p>
        </section>
      </>
    );
  }

  let citations: Record<string, ResearchSourceCitation[]> | null = null;
  try {
    citations = await listResearchSourceCitations(project.id);
  } catch (e) {
    unstable_rethrow(e);
    console.error("[project source citations]", e);
  }

  const counts = {
    all: sources.length,
    verified: sources.filter((x) => x.review_status === "verified").length,
    unverified: sources.filter((x) => x.review_status === "unverified").length,
  };
  const shown = filter === "all" ? sources : sources.filter((x) => x.review_status === filter);
  const today = todayKst();

  return (
    <>
      <Header projectId={project.id} title={project.title} />

      <section className={styles.section} aria-labelledby="sources-add">
        <h2 id="sources-add" className={styles.subtitle}>
          출처 추가
        </h2>
        <p className={styles.muted}>
          통계·보고서·기사처럼 브리프 주장의 근거로 쓸 외부 자료를 적어 둡니다. 추가한 출처는 &lsquo;확인 전&rsquo;으로 시작하고, 원문을 직접 열어 본 뒤
          &lsquo;확인함&rsquo;으로 바꿉니다. 주소와 확인 날짜는 저장한 뒤 바꿀 수 없습니다.
        </p>
        {/* 넓은 화면은 그대로, 휴대폰은 '출처 추가 열기' 버튼으로 아래쪽 창에서 연다(자료 추가와 같은 방식) */}
        <MobileActionSheet title="출처 추가">
          <ActionForm action={addResearchSourceAction} submitLabel="출처 추가" pendingLabel="추가하는 중…">
            <input type="hidden" name="projectId" value={project.id} />
            <div className={styles.field}>
              <label htmlFor="source-url">원문 주소 (필수)</label>
              <input id="source-url" name="url" type="url" inputMode="url" placeholder="https://" maxLength={RESEARCH_SOURCE_LIMITS.url} aria-describedby="source-url-help" />
              <span id="source-url-help" className={styles.muted}>
                http:// 또는 https:// 로 시작하는 주소
              </span>
            </div>
            <div className={styles.field}>
              <label htmlFor="source-title">제목 (필수)</label>
              <input id="source-title" name="title" maxLength={RESEARCH_SOURCE_LIMITS.title} aria-describedby="source-title-help" />
              <span id="source-title-help" className={styles.muted}>
                보고서 이름, 기사 제목 또는 통계 이름 ({RESEARCH_SOURCE_LIMITS.title}자까지)
              </span>
            </div>
            <div className={styles.field}>
              <label htmlFor="source-publisher">발행처 (선택)</label>
              <input id="source-publisher" name="publisher" maxLength={RESEARCH_SOURCE_LIMITS.publisher} placeholder="예: 통계청, 한국콘텐츠진흥원" />
            </div>
            <div className={styles.field}>
              <label htmlFor="source-retrieved">확인한 날짜 (필수)</label>
              <input id="source-retrieved" name="retrievedAt" type="date" defaultValue={today} max={today} aria-describedby="source-retrieved-help" />
              <span id="source-retrieved-help" className={styles.muted}>
                원문을 열어 본 날짜(한국 시각). 오늘보다 뒤는 고를 수 없습니다.
              </span>
            </div>
            <div className={styles.field}>
              <label htmlFor="source-excerpt">인용문 (선택)</label>
              <textarea id="source-excerpt" name="quotedExcerpt" maxLength={RESEARCH_SOURCE_LIMITS.excerpt} aria-describedby="source-excerpt-help" />
              <span id="source-excerpt-help" className={styles.muted}>
                브리프 주장의 근거가 되는 원문 문장을 그대로 옮겨 둡니다 ({RESEARCH_SOURCE_LIMITS.excerpt}자까지).
              </span>
            </div>
          </ActionForm>
        </MobileActionSheet>
      </section>

      <section className={styles.section} aria-labelledby="sources-list">
        <h2 id="sources-list" className={styles.subtitle}>
          출처 목록
        </h2>
        {citations === null && counts.all > 0 && (
          <p className={styles.error} role="alert">
            출처를 인용한 브리프 목록을 불러오지 못했습니다. 출처 목록은 그대로 볼 수 있습니다.
          </p>
        )}
        {counts.all > 0 && (
          <nav aria-label="검토 상태로 걸러 보기">
            <ul className={s.filters}>
              {FILTERS.map((f) => (
                <li key={f.key}>
                  <Link
                    href={f.key === "all" ? base : `${base}?status=${f.key}`}
                    className={`${s.filter} ${filter === f.key ? s.filterActive : ""}`}
                    aria-current={filter === f.key ? "page" : undefined}
                  >
                    {f.label} <span className={s.filterCount}>{counts[f.key]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {counts.all === 0 ? (
          <div className={styles.emptyState}>
            <strong>아직 등록한 외부 출처가 없습니다.</strong>
            <p className={styles.muted}>위 &lsquo;출처 추가&rsquo;에서 통계나 기사 주소를 적어 두면, 콘텐츠 브리프에서 주장의 근거로 고를 수 있습니다.</p>
          </div>
        ) : shown.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>&lsquo;{REVIEW_LABELS[filter as ResearchReviewStatus]}&rsquo; 상태인 출처가 없습니다.</strong>
            <p className={styles.row}>
              <Link href={base} className={`${styles.secondaryButton} ${styles.touchTarget}`}>
                전체 보기
              </Link>
            </p>
          </div>
        ) : (
          <ul className={s.cards} aria-label="외부 출처 목록">
            {shown.map((src) => (
              <SourceCard key={src.id} src={src} citations={citations === null ? null : (citations[src.id] ?? [])} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Header({ projectId, title }: { projectId: string; title: string }) {
  return (
    <>
      <p className={s.back}>
        <Link href={`/projects/${projectId}`} className={styles.touchLink}>
          ← 프로젝트로 ({title})
        </Link>
      </p>
      <div className={styles.header}>
        <h1 className={`${styles.title} ${styles.titleWrap}`}>외부 출처</h1>
      </div>
    </>
  );
}

/** 같은 브리프의 주장끼리 묶는다(서버는 주장 1개 = 1줄, 브리프 제목 순) */
function groupByBrief(rows: ResearchSourceCitation[]) {
  const map = new Map<string, { briefId: string; briefTitle: string; channel: string; taskId: string; claims: string[] }>();
  for (const r of rows) {
    const g = map.get(r.briefId) ?? { briefId: r.briefId, briefTitle: r.briefTitle, channel: r.channel, taskId: r.taskId, claims: [] };
    g.claims.push(r.claimText);
    map.set(r.briefId, g);
  }
  return [...map.values()];
}

function SourceCard({ src, citations }: { src: ResearchSourceSummary; citations: ResearchSourceCitation[] | null }) {
  const verified = src.review_status === "verified";
  const headingId = `source-${src.id}`;
  return (
    <li className={s.card}>
      <article aria-labelledby={headingId} className={s.cardInner}>
      <div className={s.cardHead}>
        <h3 id={headingId} className={s.cardTitle}>
          {src.title}
        </h3>
        <span className={`${styles.pill} ${verified ? styles.pillInfo : styles.pillWarning}`}>{REVIEW_LABELS[src.review_status]}</span>
      </div>
      <p className={`${styles.muted} ${s.meta}`}>
        {src.publisher && <span>발행처: {src.publisher}</span>}
        <span>확인한 날짜: {kstDate(src.retrieved_at)}</span>
      </p>
      <p className={s.url}>
        <a href={src.url} target="_blank" rel="noopener noreferrer nofollow" className={s.urlLink} title={src.url}>
          {/* 화면 읽기 전용 안내는 앞에 둔다(말줄임으로 잘리는 긴 주소 끝에 두면 화면 밖에 놓인다) */}
          <span className={styles.srOnly}>원문 열기(새 창): </span>
          {shortUrl(src.url)}
        </a>
      </p>
      {src.quoted_excerpt && (
        <blockquote className={s.excerpt}>
          <p>{src.quoted_excerpt}</p>
        </blockquote>
      )}
      {citations !== null && <Citations headingId={`${headingId}-cites`} rows={citations} />}
      <div className={s.cardActions}>
        <ActionForm
          action={setResearchSourceReviewAction}
          submitLabel={verified ? "확인 전으로 되돌리기" : "원문 확인함으로 표시"}
          pendingLabel="바꾸는 중…"
          className={styles.row}
          variant={verified ? "secondary" : "primary"}
        >
          <input type="hidden" name="sourceId" value={src.id} />
          <input type="hidden" name="status" value={verified ? "unverified" : "verified"} />
          <input type="hidden" name="revision" value={src.revision} />
        </ActionForm>
      </div>
      </article>
    </li>
  );
}

function Citations({ headingId, rows }: { headingId: string; rows: ResearchSourceCitation[] }) {
  const briefs = groupByBrief(rows);
  return (
    <section className={s.cites} aria-labelledby={headingId}>
      <h4 id={headingId} className={s.citesTitle}>
        이 출처를 인용한 브리프 {briefs.length > 0 && `(${briefs.length}개)`}
      </h4>
      {briefs.length === 0 ? (
        <p className={`${styles.muted} ${s.noCites}`}>아직 인용한 브리프가 없습니다.</p>
      ) : (
        <ul className={s.citeList}>
          {briefs.map((b) => (
            <li key={b.briefId}>
              <Link href={`/tasks/${b.taskId}?brief=${b.briefId}#brief`} className={s.citeLink}>
                <span className={styles.badge}>{BRIEF_CHANNELS[b.channel as keyof typeof BRIEF_CHANNELS] ?? b.channel}</span>
                <span>{b.briefTitle}</span>
              </Link>
              <ul className={s.citeClaims} aria-label={`${b.briefTitle}에서 이 출처를 근거로 단 주장`}>
                {b.claims.map((c, i) => (
                  <li key={i}>주장: {c}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
