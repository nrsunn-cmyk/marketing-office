"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CONTACT, CTA, SERVICE_OPTIONS } from "./brand-copy";
import {
  CONTACT_LIMITS,
  HONEYPOT_FIELD,
  firstErrorField,
  mergePreset,
  readContactForm,
  validateContact,
  type ContactErrors,
  type ContactField,
  type ContactSubmit,
} from "./contact-model";
import s from "./nadaum.module.css";

/** 서비스 카드 → 상담 폼 미리 선택 신호(카드와 폼은 서로 다른 구획이라 브라우저 이벤트로 잇는다) */
const PRESET_EVENT = "nadaum:contact-preset";

/** 상담 폼에 서비스를 더해 고르라는 신호(서비스 카드·작업물 상세의 '비슷한 프로젝트 상담하기'가 함께 쓴다) */
export function requestContactPreset(preset: readonly string[]) {
  window.dispatchEvent(new CustomEvent(PRESET_EVENT, { detail: [...preset] }));
}

/**
 * 서비스 카드 전체 링크(#contact). 누르면 폼에 해당 서비스를 더해 고른다(기존 선택 유지, 방문자가 바꿀 수 있음).
 * 스크립트가 없어도 #contact 로는 이동한다.
 */
export function PresetLink({ preset, className, children }: { preset: readonly string[]; className?: string; children: ReactNode }) {
  return (
    <a href="#contact" className={className} onClick={() => requestContactPreset(preset)}>
      {children}
    </a>
  );
}

type Status =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "sent"; refCode: string }
  | { kind: "failed"; message: string }
  | { kind: "not_connected" };

const FIELD_ID: Record<ContactField, string> = {
  company_name: "nd-company",
  contact_name: "nd-name",
  phone: "nd-phone",
  reference_url: "nd-url",
  services: "nd-svc-0",
  other_service: "nd-other",
  message: "nd-msg",
  desired_timeline: "nd-timeline",
  budget_range: "nd-budget",
  privacy_consent: "nd-consent",
};

/**
 * SECTION 07 CONTACT 통합 상담 폼.
 * - submit 이 없으면(접수 서버 미연결 미리보기) 제출해도 성공으로 보이지 않고 미리보기 안내만 띄운다
 * - 실패·미연결이면 입력을 그대로 둔다(칸을 비우지 않음). 성공 문구는 서버 저장 확인('sent') 뒤에만
 */
export function ContactForm({ submit }: { submit?: ContactSubmit }) {
  const [services, setServices] = useState<string[]>([]);
  const [errors, setErrors] = useState<ContactErrors>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const formRef = useRef<HTMLFormElement>(null);
  const moreRef = useRef<HTMLDetailsElement>(null);
  // 사람 확인: 폼을 그린 뒤 지난 시간(서버가 너무 빠른 자동 제출을 거른다). PC 시계와 무관한 단조 시계로 잰다
  const mountedAt = useRef<number | null>(null);
  useEffect(() => {
    mountedAt.current = performance.now();
  }, []);

  useEffect(() => {
    const onPreset = (ev: Event) => {
      const preset = (ev as CustomEvent<string[]>).detail ?? [];
      setServices((cur) => mergePreset(cur, preset));
      setErrors((e) => ({ ...e, services: undefined }));
      // 이동 뒤 키보드 초점을 폼 첫 칸으로(화면은 #contact 위치 그대로)
      requestAnimationFrame(() => document.getElementById(FIELD_ID.company_name)?.focus({ preventScroll: true }));
    };
    window.addEventListener(PRESET_EVENT, onPreset);
    return () => window.removeEventListener(PRESET_EVENT, onPreset);
  }, []);

  const toggle = (v: string, on: boolean) => setServices((cur) => (on ? mergePreset(cur, [v]) : cur.filter((x) => x !== v)));

  /** 오류 칸으로 초점(접힌 선택 칸의 오류면 먼저 펼친다) */
  const focusFirst = (found: ContactErrors) => {
    const first = firstErrorField(found);
    if (!first) return false;
    if ((first === "desired_timeline" || first === "budget_range") && moreRef.current) moreRef.current.open = true;
    requestAnimationFrame(() => document.getElementById(FIELD_ID[first])?.focus());
    return true;
  };

  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (status.kind === "pending") return;
    const fd = new FormData(ev.currentTarget);
    const input = readContactForm(fd);
    const found = validateContact(input);
    setErrors(found);
    if (focusFirst(found)) {
      setStatus({ kind: "idle" });
      return;
    }
    if (!submit) {
      setStatus({ kind: "not_connected" });
      return;
    }
    setStatus({ kind: "pending" });
    try {
      const r = await submit(input, { honeypot: String(fd.get(HONEYPOT_FIELD) ?? ""), elapsedMs: mountedAt.current === null ? null : Math.round(performance.now() - mountedAt.current) });
      if (r.status === "sent") {
        // 서버가 저장을 확인했을 때만 성공(입력을 비운다)
        formRef.current?.reset();
        setServices([]);
        setStatus({ kind: "sent", refCode: r.refCode });
      } else {
        // 실패·제한·접수 꺼짐: 입력은 그대로, 서버 문구를 보인다
        const fe = r.errors ?? {};
        setErrors(fe);
        focusFirst(fe);
        setStatus({ kind: "failed", message: r.message || CONTACT.failure });
      }
    } catch {
      setStatus({ kind: "failed", message: CONTACT.failure });
    }
  }

  const err = (f: ContactField) =>
    errors[f] ? (
      <p id={`${FIELD_ID[f]}-err`} className={s.fieldError}>
        {errors[f]}
      </p>
    ) : null;
  const a11y = (f: ContactField) => ({ "aria-invalid": errors[f] ? true : undefined, "aria-describedby": errors[f] ? `${FIELD_ID[f]}-err` : undefined });
  const hasErrors = Object.values(errors).some(Boolean);
  const other = services.includes("기타");

  return (
    <form ref={formRef} className={s.contactBox} onSubmit={onSubmit} noValidate aria-labelledby="contact-title">
      <div>
        <span className={s.eyebrow}>{CONTACT.eyebrow}</span>
        <h2 id="contact-title" className={s.secTitle}>
          {CONTACT.title}
        </h2>
        <p className={s.lead}>{CONTACT.desc}</p>
      </div>

      {hasErrors && (
        <p className={s.errorSummary} role="alert">
          {CONTACT.errorSummary}
        </p>
      )}

      <div className={s.formGrid}>
        <div className={s.field}>
          <label htmlFor="nd-company">{CONTACT.labels.company}</label>
          <input id="nd-company" name="company_name" className={s.input} required maxLength={CONTACT_LIMITS.company} autoComplete="organization" placeholder={CONTACT.placeholders.company} {...a11y("company_name")} />
          {err("company_name")}
        </div>
        <div className={s.field}>
          <label htmlFor="nd-name">{CONTACT.labels.name}</label>
          <input id="nd-name" name="contact_name" className={s.input} required maxLength={CONTACT_LIMITS.name} autoComplete="name" placeholder={CONTACT.placeholders.name} {...a11y("contact_name")} />
          {err("contact_name")}
        </div>
        <div className={s.field}>
          <label htmlFor="nd-phone">{CONTACT.labels.phone}</label>
          <input id="nd-phone" name="phone" type="tel" inputMode="tel" className={s.input} required maxLength={CONTACT_LIMITS.phone} autoComplete="tel" placeholder={CONTACT.placeholders.phone} {...a11y("phone")} />
          {err("phone")}
        </div>
        <div className={s.field}>
          <label htmlFor="nd-url">{CONTACT.labels.url}</label>
          <input id="nd-url" name="reference_url" type="url" inputMode="url" className={s.input} maxLength={CONTACT_LIMITS.url} placeholder={CONTACT.placeholders.url} {...a11y("reference_url")} />
          {err("reference_url")}
        </div>
      </div>

      <fieldset className={s.fieldset} aria-describedby={errors.services ? "nd-svc-0-err" : undefined}>
        <legend className={s.legend}>{CONTACT.labels.services}</legend>
        <div className={s.chipGroup}>
          {SERVICE_OPTIONS.map((o, i) => (
            <label key={o} className={s.chip}>
              <input id={`nd-svc-${i}`} type="checkbox" name="services" value={o} checked={services.includes(o)} onChange={(e) => toggle(o, e.currentTarget.checked)} />
              {o}
            </label>
          ))}
        </div>
        {err("services")}
      </fieldset>

      {other && (
        <div className={s.field}>
          <label htmlFor="nd-other">{CONTACT.labels.other}</label>
          <input id="nd-other" name="other_service" className={s.input} required maxLength={CONTACT_LIMITS.other} placeholder={CONTACT.placeholders.other} {...a11y("other_service")} />
          {err("other_service")}
        </div>
      )}

      <div className={s.field}>
        <label htmlFor="nd-msg">{CONTACT.labels.message}</label>
        <textarea id="nd-msg" name="message" className={`${s.input} ${s.textarea}`} required maxLength={CONTACT_LIMITS.message} placeholder={CONTACT.placeholders.message} {...a11y("message")} />
        {err("message")}
      </div>

      <details ref={moreRef} className={s.more}>
        <summary>{CONTACT.labels.more}</summary>
        <div className={s.formGrid}>
          <div className={s.field}>
            <label htmlFor="nd-timeline">{CONTACT.labels.timeline}</label>
            <input id="nd-timeline" name="desired_timeline" className={s.input} maxLength={CONTACT_LIMITS.short} {...a11y("desired_timeline")} />
            {err("desired_timeline")}
          </div>
          <div className={s.field}>
            <label htmlFor="nd-budget">{CONTACT.labels.budget}</label>
            <input id="nd-budget" name="budget_range" className={s.input} maxLength={CONTACT_LIMITS.short} {...a11y("budget_range")} />
            {err("budget_range")}
          </div>
        </div>
      </details>

      {/* 자동 입력 방지 숨은 칸: 사람에게 보이지 않고 화면 읽기·탭 순서에서도 빠진다. 값이 있으면 서버가 저장하지 않는다 */}
      <div className={s.honeypot} aria-hidden="true">
        <label htmlFor="nd-website">웹사이트</label>
        <input id="nd-website" name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <div className={s.field}>
        <label className={`${s.chip} ${s.consent}`}>
          <input
            id="nd-consent"
            type="checkbox"
            name="privacy_consent"
            required
            aria-invalid={errors.privacy_consent ? true : undefined}
            aria-describedby={errors.privacy_consent ? "nd-privacy nd-consent-err" : "nd-privacy"}
          />
          {CONTACT.labels.consent}
        </label>
        {/* 오류 문구는 체크박스 바로 아래(안내 카드보다 먼저) */}
        {err("privacy_consent")}
        {/* 개인정보 보호법 제15조 제2항 고지 4요소: 동의 전에 바로 읽히도록 늘 펼쳐 두고 동의 칸과 aria-describedby 로 잇는다 */}
        <dl id="nd-privacy" className={s.privacyNotice}>
          {CONTACT.privacy.map((p) => (
            <div key={p.term}>
              <dt>{p.term}</dt>
              <dd>{p.desc}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <button type="submit" className={`${s.btn} ${s.btnPrimary}`} aria-disabled={status.kind === "pending" ? true : undefined}>
          {CTA.submit}
        </button>
      </div>

      {/* 결과 안내 영역은 늘 두고 글만 바꾼다(화면 읽기 프로그램이 한 번 읽음) */}
      <div role="status" aria-live="polite" aria-atomic="true">
        {status.kind === "sent" && (
          <p className={s.statusOk}>
            {CONTACT.success}
            <br />
            {CONTACT.refLabel} <strong>{status.refCode}</strong>
          </p>
        )}
        {status.kind === "failed" && <p className={s.statusError}>{status.message}</p>}
        {status.kind === "not_connected" && <p className={s.statusPreview}>{CONTACT.notConnected}</p>}
      </div>
    </form>
  );
}
