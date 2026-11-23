import Image from "next/image";
import { CTA, FAQ, FOOTER, HERO, HOOK, NAV, SERVICES, STATEMENT, WORKS, WORK_STATUS_LABEL } from "./brand-copy";
import { ContactForm, PresetLink } from "./brand-contact";
import { FaqAccordion } from "./brand-faq";
import type { ContactSubmit } from "./contact-model";
import s from "./nadaum.module.css";

/**
 * NADAUM-BRAND-FRONT-01 나다움브랜드 공개 홍보 화면(/). 배치는 3안 스페이셜 벤토(NADAUM-BRAND-CONCEPT3-FRONT-01, CONCEPT-3-FINAL-SPEC 4~9).
 * 기획서(DOCX) 3절 순서: 헤더 → 첫 화면 → 서비스 → 후킹 → 작업물 → 브랜드 한 줄 → FAQ → 상담 → 푸터.
 * 색·간격은 AGY tokens-nadaum-brand.css 를 이 화면 안(.root)에만 둔다(업무실·관리자 화면에 번지지 않음).
 * 기존 마케팅 업무실 소개(landing-page.tsx)는 그대로 보존하고, / 연결만 이 화면으로 바꾼다.
 */
export function NadaumHome({ submit }: { submit?: ContactSubmit }) {
  return (
    <div className={s.root}>
      <a href="#main" className={s.skip}>
        본문으로 건너뛰기
      </a>
      <header className={s.header}>
        <div className={`${s.container} ${s.headerInner}`}>
          <a href="#top" className={s.brandLogo} aria-label="NADAUM 맨 위로">
            <Image src="/brand/nadaum/nadaum-logo.svg" alt="NADAUM" width={127} height={24} unoptimized loading="eager" className={s.logoImg} />
          </a>
          <nav className={s.nav} aria-label="주 메뉴">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className={`${s.navLink} ${s.navWide}`}>
                {n.label}
              </a>
            ))}
            {/* 모바일: 로고와 '상담하기'를 먼저, 나머지 이동은 간결한 메뉴로(기획서 SECTION 00) */}
            <details className={s.navMenu}>
              <summary className={s.navMenuBtn}>메뉴</summary>
              <ul className={s.navMenuList}>
                {NAV.map((n) => (
                  <li key={n.href}>
                    <a href={n.href} className={s.navLink}>
                      {n.label}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
            <a href="#contact" className={`${s.btn} ${s.btnPrimary}`}>
              {CTA.contact}
            </a>
          </nav>
        </div>
      </header>

      <main id="main">
        {/* SECTION 01 HERO */}
        <section id="top" className={s.section} aria-labelledby="hero-title">
          <div className={s.container}>
            {/* 3안 스페이셜 벤토: 글 타일 + 비주얼 타일(모바일은 글이 먼저) */}
            <div className={s.heroBento}>
              <div className={s.heroText}>
                <span className={s.eyebrow}>{HERO.eyebrow}</span>
                <h1 id="hero-title" className={s.heroTitle}>
                  {HERO.titleLines[0]}
                  <br />
                  {HERO.titleLines[1]}
                </h1>
                <p className={s.lead}>{HERO.desc}</p>
                <div className={s.ctaRow}>
                  <a href="#contact" className={`${s.btn} ${s.btnPrimary}`}>
                    {CTA.contact}
                  </a>
                  <a href="#works" className={`${s.btn} ${s.btnOutline}`}>
                    {CTA.works}
                  </a>
                </div>
              </div>
              <div className={s.heroVisual} aria-hidden="true">
                {/* AGY 1차 대체 SVG(워터마크 없는 자체 자산). 최종 3D 이미지가 오면 같은 경로로 교체 */}
                <Image src="/brand/nadaum/mobius-hero.svg" alt="" width={640} height={380} unoptimized loading="eager" className={s.mobius} />
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 02 SERVICES */}
        <section id="services" className={s.section} aria-labelledby="services-title">
          <div className={s.container}>
            <div className={s.secHead}>
              <span className={s.eyebrow}>{SERVICES.eyebrow}</span>
              <h2 id="services-title" className={s.secTitle}>
                {SERVICES.title}
              </h2>
            </div>
            <ul className={`${s.grid3} ${s.serviceGrid}`}>
              {SERVICES.cards.map((c, i) => (
                <li key={c.title} className={i === 0 ? s.featuredItem : undefined}>
                  {/* 3안: 첫 카드(홈페이지 제작)를 넓게 강조 */}
                  <PresetLink preset={c.preset} className={`${s.card} ${s.serviceCard}${i === 0 ? ` ${s.featured}` : ""}`}>
                    <Image src={c.image} alt="" width={480} height={280} unoptimized className={s.cardImg} />
                    <h3 className={s.cardTitle}>{c.title}</h3>
                    <p className={s.cardDesc}>{c.desc}</p>
                  </PresetLink>
                </li>
              ))}
            </ul>
            <p className={s.subServices}>{SERVICES.more}</p>
          </div>
        </section>

        {/* SECTION 03 MID-PAGE HOOK — 상담 단추를 두지 않는다 */}
        <section className={s.section} aria-labelledby="hook-title">
          <div className={s.container}>
            <div className={s.banner}>
              <span className={s.eyebrow}>{HOOK.eyebrow}</span>
              <h2 id="hook-title" className={s.statementTitle}>
                {HOOK.title}
              </h2>
              <p className={`${s.lead} ${s.center}`}>{HOOK.desc}</p>
            </div>
          </div>
        </section>

        {/* SECTION 04 WORKS — 공개 허락된 사례가 없으면 '프로젝트 준비 중'(지어낸 사례 없음) */}
        <section id="works" className={s.section} aria-labelledby="works-title">
          <div className={s.container}>
            <div className={s.secHead}>
              <span className={s.eyebrow}>{WORKS.eyebrow}</span>
              <h2 id="works-title" className={s.secTitle}>
                {WORKS.title}
              </h2>
            </div>
            <ul className={s.grid3}>
              {WORKS.items.map((w) => (
                <li key={w.type} className={s.card}>
                  <div className={s.workThumb}>{WORK_STATUS_LABEL[w.status]}</div>
                  <h3 className={s.cardTitle}>{w.type}</h3>
                  <p className={s.cardDesc}>
                    <span className={s.statusTag}>{WORK_STATUS_LABEL[w.status]}</span>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* SECTION 05 BRAND STATEMENT — 설명 없이 한 문장 */}
        <section className={s.section} aria-labelledby="statement-title">
          <div className={s.container}>
            <div className={s.banner}>
              <span className={s.eyebrow}>{STATEMENT.eyebrow}</span>
              <h2 id="statement-title" className={s.statementTitle}>
                {STATEMENT.title}
              </h2>
            </div>
          </div>
        </section>

        {/* SECTION 06 FAQ */}
        <section id="faq" className={s.section} aria-labelledby="faq-title">
          <div className={s.container}>
            <div className={s.secHead}>
              <h2 id="faq-title" className={s.secTitle}>
                {FAQ.title}
              </h2>
            </div>
            <FaqAccordion />
          </div>
        </section>

        {/* SECTION 07 CONTACT */}
        <section id="contact" className={s.section} aria-labelledby="contact-title">
          <div className={s.container}>
            <ContactForm submit={submit} />
          </div>
        </section>
      </main>

      {/* SECTION 08 FOOTER — 주소·임의 이메일 없음, 전화번호는 확정 전까지 자리 표시 */}
      <footer className={s.footer}>
        <div className={`${s.container} ${s.footerInner}`}>
          <div className={s.footerBrand}>
            <Image src="/brand/nadaum/nadaum-logo.svg" alt="" width={106} height={20} unoptimized className={s.footerLogo} />
            <span>{FOOTER.name}</span>
            <span>{FOOTER.phone}</span>
          </div>
          <span>{FOOTER.copyright}</span>
        </div>
      </footer>
    </div>
  );
}
