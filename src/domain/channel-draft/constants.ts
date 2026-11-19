/** 채널 초안(P2-g) 상수(zod 없음). 화면이 상수만 가져올 때 zod 가 브라우저 묶음에 실리지 않게 따로 둔다. 값은 DB 규칙(migration 27)과 같게 둔다 */

/** 주인님 DEC-16: 첫 자체 채널은 티스토리 블로그 하나, 한국어만. 자동 게시는 없다(R08) */
export const CHANNEL_DRAFT_CHANNEL = "tistory" as const;
export const CHANNEL_DRAFT_CHANNEL_LABEL = "티스토리 블로그";
export const CHANNEL_DRAFT_LANGUAGE = "ko" as const;
export const CHANNEL_DRAFT_LANGUAGE_LABEL = "한국어";
/** 초안을 만들 수 있는 브리프 채널(DB create_channel_draft 와 같음) */
export const CHANNEL_DRAFT_BRIEF_CHANNEL = "blog" as const;

/** 저장 상태(DB). "게시 기록됨"은 저장하지 않고 취소되지 않은 게시 기록에서 계산한다 */
export const CHANNEL_DRAFT_STATUSES = { drafting: "작성 중", reviewed: "검토 완료" } as const;
export type ChannelDraftStatus = keyof typeof CHANNEL_DRAFT_STATUSES;

/** 화면에 보이는 상태 4종(AGY DESIGN-P2G-01). 우선순위: 보관 > 게시 기록됨 > 검토 완료 > 작성 중 */
export const CHANNEL_DRAFT_DISPLAY_STATUSES = { drafting: "작성 중", reviewed: "검토 완료", published: "게시 기록됨", archived: "보관" } as const;
export type ChannelDraftDisplayStatus = keyof typeof CHANNEL_DRAFT_DISPLAY_STATUSES;

export function channelDraftDisplayStatus(d: { archived: boolean; hasActivePublication: boolean; status: ChannelDraftStatus }): ChannelDraftDisplayStatus {
  if (d.archived) return "archived";
  if (d.hasActivePublication) return "published";
  return d.status;
}

/** 글자 수는 코드 포인트로 센다(DB length() 와 같음 — 이모지 하나는 1자) */
export const CHANNEL_DRAFT_LIMITS = {
  title: 200,
  body: 20000,
  tags: 10,
  tag: 30,
  imageNote: 500,
  metaDescription: 300,
  /** 화면 안내용 권장 길이(막지 않음) */
  metaDescriptionRecommended: 160,
  tagsRecommended: 10,
  perBrief: 5,
  /** 취소하지 않은 게시 기록 수(취소 행은 세지 않는다, QA D3) */
  publicationsPerDraft: 50,
  publicationUrl: 2048,
  publicationNote: 300,
  /** 게시 시각은 지금부터 이만큼 앞까지만(record_delivery 와 같음) */
  futureSkewMs: 5 * 60 * 1000,
} as const;

/** 게시 시각 하한(DB 와 같음, KST) */
export const PUBLICATION_MIN_AT = "2000-01-01T00:00:00+09:00";

/**
 * 게시 주소 규칙(DB app.publication_url_ok 와 글자 하나까지 같은 식, QA D1). https:// + 점이 있는 ASCII 호스트(+포트) + 보이는 ASCII(!~)만인 나머지.
 * @·\ 는 호스트 글자가 아니라 사용자 정보·역슬래시 우회가 거절된다. 공백·제어·서식 문자(ZWSP·RLO, QA D2)는 나머지에 올 수 없다.
 * new URL().href 는 한글 경로를 %인코딩하므로 정규화한 값은 늘 이 식에 맞는다. 길이(2048)는 따로 본다.
 */
export const PUBLICATION_URL_RE = /^https:\/\/[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+(:[0-9]{1,5})?([/?#][!-~]*)?$/;

/** 저장·표시 전 마지막 확인: 이 규칙을 통과한 값만 링크(href)로 쓴다 */
export const isSafeHttpsUrl = (u: string | null | undefined): u is string => typeof u === "string" && u.length <= CHANNEL_DRAFT_LIMITS.publicationUrl && PUBLICATION_URL_RE.test(u);

/** 티스토리 기본 주소인지(막지 않고 안내만 — 개인 도메인 연결 블로그가 있으므로, Master 9-①) */
export function isTistoryHost(u: string): boolean {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h === "tistory.com" || h.endsWith(".tistory.com");
  } catch {
    return false;
  }
}

/** 코드 포인트 길이 */
export const charLength = (s: string) => [...s].length;
