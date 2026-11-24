import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/** NADAUM-BRAND-FRONT-01 나다움브랜드 공개 화면: 기획서(DOCX) 문구·순서·앵커·버튼 이름·가짜 정보 없음·접근성 속성 */
vi.mock("./nadaum.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

const { NadaumHome } = await import("./nadaum-home");
const { BRAND_INDEXABLE, CONTACT, CTA, FAQ, FOOTER, PHONE_PLACEHOLDER, PRIVACY_RETENTION, SERVICE_OPTIONS, SERVICES, SHOW_FOOTER_WORKSPACE_LOGIN } = await import("./brand-copy");
const { brandRobots } = await import("./brand-seo");
const { PORTFOLIO_ITEMS, hasVerifiedWorks } = await import("./portfolio-data");

const html = renderToString(createElement(NadaumHome)).replaceAll("<!-- -->", "");
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const t = text(html);
const count = (re: RegExp) => (html.match(re) ?? []).length;

describe("나다움브랜드 공개 화면", () => {
  it("기획서 순서: 헤더 → 첫 화면 → 서비스 → 후킹 → 작업물 → 브랜드 한 줄 → FAQ → 상담 → 푸터", () => {
    const order = [
      "AI CREATIVE PARTNER",
      "나다움을 발견하고,",
      "WHAT WE CREATE",
      "보여주는 디자인에서, 선택받는 경험으로.",
      "결과물로 보여드리겠습니다.",
      "하나의 브랜드, 끝없이 이어지는 가능성.",
      "자주 묻는 질문",
      "당신의 브랜드, 다음 장면은 무엇인가요?",
      "© NADAUM BRAND",
    ];
    const idx = order.map((s) => t.indexOf(s));
    expect(idx.every((i) => i >= 0), JSON.stringify(idx)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(html.indexOf("<header")).toBeLessThan(html.indexOf("<main"));
    expect(html.indexOf("</main>")).toBeLessThan(html.indexOf("<footer"));
  });

  it("h1 하나(헤드라인), 확정 설명문, 섹션 앵커 #top·#services·#works·#contact 가 있고 링크가 모두 실제 id 를 가리킨다", () => {
    expect(count(/<h1[\s>]/g)).toBe(1);
    expect(t).toContain("나다움을 발견하고, 가능성을 넓히다.");
    expect(t).toContain("홈페이지·상세페이지·AI 영상 제작까지. 브랜드의 시작과 성장을 하나로 연결합니다.");
    const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    for (const a of ["top", "services", "works", "contact", "main"]) expect(ids.has(a), a).toBe(true);
    const hrefs = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) expect(ids.has(h), `#${h}`).toBe(true);
  });

  it("버튼 이름 규칙: 상담 진입은 '상담하기'(모두 #contact), 포트폴리오는 '작업물 보기'(#works), 제출은 폼 안 '상담 신청 완료하기' 하나", () => {
    const links = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs)].map((m) => ({ href: m[1], label: text(m[2]).trim() }));
    const contact = links.filter((l) => l.label === CTA.contact);
    expect(contact.length).toBe(2); // 헤더 + 첫 화면(후킹·서비스 카드에는 별도 단추 없음)
    for (const l of contact) expect(l.href).toBe("#contact");
    expect(links.filter((l) => l.label === CTA.works).map((l) => l.href)).toEqual(["#works"]);
    expect(count(/<button[^>]*type="submit"/g)).toBe(1);
    expect(t).toContain(CTA.submit);
    for (const bad of ["프로젝트 문의", "홈페이지 상담하기", "상세페이지 상담하기", "제작 신청하기"]) expect(t).not.toContain(bad);
  });

  it("서비스 카드 3장(홈페이지 제작이 첫째), 카드 전체가 #contact 링크, 보조 한 줄", () => {
    const pos = SERVICES.cards.map((c) => t.indexOf(c.title + " "));
    expect(SERVICES.cards.map((c) => c.title)).toEqual(["홈페이지 제작", "상세페이지 제작", "AI 영상·비주얼"]);
    expect(pos.every((p) => p > 0)).toBe(true);
    expect(count(/class="card serviceCard( featured)?"/g)).toBe(3);
    // 3안 스페이셜 벤토: 첫 카드(홈페이지 제작)만 강조, 서비스 목록은 전용 3단 격자, 히어로는 글·비주얼 두 타일, 후킹·브랜드 한 줄은 배너
    expect(count(/class="card serviceCard featured"/g)).toBe(1);
    expect(html.indexOf("card serviceCard featured")).toBeLessThan(html.indexOf("상세페이지 제작"));
    expect(html).toContain('class="grid3 serviceGrid"');
    expect(html).toMatch(/class="heroBento"><div class="heroText">/);
    expect(count(/class="banner"/g)).toBe(2);
    expect(t).toContain(SERVICES.more);
    // AI 영상·비주얼 → 영상·비주얼 두 개 미리 선택(AGY 인계 3절), 모두 폼의 7종 안
    expect(SERVICES.cards[2].preset).toEqual(["쇼츠·릴스 영상", "광고·상품 이미지"]);
    for (const c of SERVICES.cards) for (const p of c.preset) expect(SERVICE_OPTIONS).toContain(p);
  });

  it("작업물: 지어낸 사례 없이 '프로젝트 준비 중', 가짜 실적·가격·주소·이메일 없음", () => {
    expect(count(/프로젝트 준비 중/g)).toBeGreaterThanOrEqual(3);
    for (const bad of [/만족도/, /전환율/, /\d+\s*%/, /\d+\s*건 이상/, /가격표|₩|원\s*부터/, /@[a-z0-9.-]+\.[a-z]{2,}/i, /서울|경기|주소:/]) expect(t).not.toMatch(bad);
    expect(t).toContain("전화: [전화번호 직접 입력 예정]");
  });

  it("FAQ 5문 5답, 처음에는 모두 닫힘(aria-expanded=false·패널 hidden), 단추가 패널을 가리킨다", () => {
    expect(FAQ.items).toHaveLength(5);
    expect(count(/aria-expanded="false"/g)).toBe(5);
    expect(count(/aria-expanded="true"/g)).toBe(0);
    for (let i = 1; i <= 5; i++) {
      expect(html).toContain(`aria-controls="faq-${i}-panel"`);
      expect(html).toMatch(new RegExp(`id="faq-${i}-panel"[^>]*hidden`));
    }
    for (const f of FAQ.items) expect(t).toContain(f.q);
  });

  it("상담 폼: 7종 복수 선택 체크박스·필수 칸 이름표·동의, 처음엔 성공·미리보기 안내가 보이지 않는다(가짜 성공 없음)", () => {
    for (const o of SERVICE_OPTIONS) expect(html).toMatch(new RegExp(`type="checkbox" name="services" value="${o}"`));
    expect(html).toContain("<fieldset");
    expect(t).toContain(CONTACT.labels.services);
    for (const [id, label] of [
      ["nd-company", CONTACT.labels.company],
      ["nd-name", CONTACT.labels.name],
      ["nd-phone", CONTACT.labels.phone],
      ["nd-msg", CONTACT.labels.message],
    ]) {
      expect(html).toContain(`for="${id}"`);
      expect(t).toContain(label);
    }
    expect(html).toMatch(/id="nd-consent"[^>]*required|required[^>]*id="nd-consent"/);
    expect(t).not.toContain(CONTACT.success);
    expect(t).not.toContain(CONTACT.notConnected);
    expect(html).toMatch(/role="status" aria-live="polite" aria-atomic="true"><\/div>/);
    expect(html).not.toContain('id="nd-other"'); // '기타'를 고르기 전에는 한 줄 칸 없음
    // 자동 입력 방지 숨은 칸: 화면 읽기에서 숨기고 탭 순서에서 뺀다
    const hp = html.match(/<div class="honeypot" aria-hidden="true">[\s\S]*?<\/div>/)?.[0] ?? "";
    const hpInput = hp.match(/<input [^>]*>/)?.[0] ?? "";
    expect(hpInput).toContain('name="website"');
    expect(hpInput).toContain('tabindex="-1"');
    expect(hpInput.toLowerCase()).toContain('autocomplete="off"');
  });

  it("장식 이미지(뫼비우스·카드)는 대체 텍스트를 비우고, 로고 링크에는 이름이 있다", () => {
    expect(html).toMatch(/aria-label="NADAUM 맨 위로"/);
    expect(html).toMatch(/alt=""[^>]*src="\/brand\/nadaum\/mobius-3d\.png"|src="\/brand\/nadaum\/mobius-3d\.png"[^>]*alt=""/);
    expect(count(/src="\/brand\/nadaum\/service-[a-z-]+\.png"/g)).toBe(3);
  });

  it("개인정보 고지 4요소(목적·항목·보유 기간·거부 권리)를 동의 칸 아래 늘 보이고 aria-describedby 로 잇는다", () => {
    const box = html.match(/<input[^>]*id="nd-consent"[^>]*>/)?.[0] ?? "";
    expect(box).toContain('aria-describedby="nd-privacy"');
    expect(t).toContain("개인정보 수집·이용에 동의합니다 (필수)");
    const dl = html.match(/<dl id="nd-privacy"[^>]*>[\s\S]*?<\/dl>/)?.[0] ?? "";
    for (const term of ["수집·이용 목적", "수집 항목", "보유·이용 기간", "동의 거부 권리 및 불이익"]) expect(dl).toContain(`<dt>${term}</dt>`);
    expect(PRIVACY_RETENTION).toBe(
      "상담 이력 관리 및 관리자 삭제 시까지 보관 (이용자 삭제 요청 시 지체 없이 파기, 관계 법령에 따라 보존이 필요한 경우 해당 기간 보관)",
    );
    expect(text(dl)).toContain(PRIVACY_RETENTION);
    expect(text(dl)).not.toContain("1년");
    expect(text(dl)).toContain("거부 시 상담 신청 접수가 제한됩니다");
  });

  it("푸터 보조 링크 '업무실 로그인'은 /login 하나(머리글에는 없음)", () => {
    expect(SHOW_FOOTER_WORKSPACE_LOGIN).toBe(true);
    const links = html.match(/<a [^>]*href="\/login"[^>]*>[^<]*<\/a>/g) ?? [];
    expect(links).toHaveLength(1);
    expect(links[0]).toContain(`>${FOOTER.login}</a>`);
    expect(links[0]).toContain("footerLogin");
    const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(header).not.toContain('href="/login"');
  });

  it("/ 연결: 새 화면을 그리고, 기존 업무실 소개 파일은 그대로 보존된다", () => {
    const page = readFileSync(join(process.cwd(), "src/app/(brand)/page.tsx"), "utf8");
    // NADAUM-BRAND-CONNECT-01: 접수 서버 동작 연결(저장 확인 때만 성공)
    expect(page).toContain("<NadaumHome submit={submitNadaumInquiry} />");
    expect(readFileSync(join(process.cwd(), "src/app/_components/landing-page.tsx"), "utf8")).toContain("export function LandingPage");
    // 나다움 파비콘은 / 묶음 폴더에만(루트 icon.svg 는 업무실·관리자용 그대로)
    expect(existsSync(join(process.cwd(), "src/app/page.tsx"))).toBe(false);
    const brandIcon = readFileSync(join(process.cwd(), "src/app/(brand)/icon.svg"), "utf8");
    expect(brandIcon).toBe(readFileSync(join(process.cwd(), "public/brand/nadaum/nadaum-favicon.svg"), "utf8"));
    expect(readFileSync(join(process.cwd(), "src/app/icon.svg"), "utf8")).not.toBe(brandIcon);
    // 공유 이미지도 / 에만(AGY nadaum-og-1200x630.png, 루트 opengraph-image.png 는 그대로)
    expect(existsSync(join(process.cwd(), "src/app/(brand)/opengraph-image.png"))).toBe(true);
    expect(existsSync(join(process.cwd(), "src/app/opengraph-image.png"))).toBe(true);
  });
});

describe("검색 노출 A안 2단계(NADAUM-BRAND-INDEX-FLAG-01)", () => {
  it("끄면 robots 를 넣지 않아 루트 noindex 를 따르고, 켜면 / 만 index·follow", () => {
    expect(brandRobots(false)).toEqual({});
    expect(brandRobots(true)).toEqual({ robots: { index: true, follow: true } });
  });

  it("1차 출시는 꺼짐(주인님 승인 A안)", () => {
    expect(BRAND_INDEXABLE).toBe(false);
  });

  it("켜려면 대표 전화번호와 실제 사례가 먼저 채워져 있어야 한다(조건 없이 켜면 실패)", () => {
    const phoneReady = !FOOTER.phone.includes(PHONE_PLACEHOLDER);
    // 실제 사례(공개 허락)가 1건 이상(NADAUM-PORTFOLIO-WORKS-FRONT-01, AGY PORTFOLIO-WORKS-SPEC-01 1절)
    const worksReady = hasVerifiedWorks(PORTFOLIO_ITEMS);
    if (BRAND_INDEXABLE) expect({ phoneReady, worksReady }).toEqual({ phoneReady: true, worksReady: true });
    else expect(FOOTER.phone).toBe(`전화: ${PHONE_PLACEHOLDER}`); // 지금 화면 글자는 그대로
  });
});

// 화면 점검용 HTML(F1_HARNESS 처럼 환경 변수로만 만든다). Plan/…/NADAUM-BRAND-FRONT-01/brand-browser.mjs 가 쓴다
if (process.env.NADAUM_HARNESS) {
  const out = process.env.NADAUM_HARNESS;
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "home.html"), html);
}
