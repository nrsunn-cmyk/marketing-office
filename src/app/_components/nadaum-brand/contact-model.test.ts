import { describe, expect, it } from "vitest";
import { SERVICE_OPTIONS } from "./brand-copy";
import { firstErrorField, mergePreset, readContactForm, validateContact, type ContactInput } from "./contact-model";

/** NADAUM-BRAND-FRONT-01 상담 폼 화면 쪽 입력 검사(서버 검증은 Backend 3B) */
const ok: ContactInput = {
  company_name: "합성 업체",
  contact_name: "홍길동",
  phone: "010-1234-5678",
  services: ["홈페이지 제작", "로고 제작", "쇼츠·릴스 영상"],
  other_service: "",
  message: "브랜드 홈페이지가 필요합니다.",
  reference_url: "",
  desired_timeline: "",
  budget_range: "",
  privacy_consent: true,
};

describe("상담 폼 입력 검사", () => {
  it("올바른 입력(여러 서비스를 한 번에)은 오류가 없다", () => {
    expect(validateContact(ok)).toEqual({});
  });

  it("필수 칸·서비스 1개 이상·동의가 없으면 각 칸에 오류, 첫 오류는 화면 순서대로", () => {
    const e = validateContact({ ...ok, company_name: "", contact_name: "", phone: "", services: [], message: "", privacy_consent: false });
    expect(Object.keys(e).sort()).toEqual(["company_name", "contact_name", "message", "phone", "privacy_consent", "services"].sort());
    expect(firstErrorField(e)).toBe("company_name");
    expect(firstErrorField(validateContact({ ...ok, services: [] }))).toBe("services");
  });

  it("연락처는 숫자 8~15자리(하이픈·공백·괄호·+ 허용), 글자가 섞이면 오류", () => {
    for (const p of ["010-1234-5678", "02 123 4567", "+82 10-1234-5678", "(031)123-4567"]) expect(validateContact({ ...ok, phone: p }).phone, p).toBeUndefined();
    for (const p of ["1234", "010-abcd-5678", "1".repeat(16)]) expect(validateContact({ ...ok, phone: p }).phone, p).toBeDefined();
  });

  it("'기타'를 고르면 한 줄 내용이 필요하고, 참고 URL 은 http(s) 주소만", () => {
    expect(validateContact({ ...ok, services: ["기타"], other_service: "" }).other_service).toBeDefined();
    expect(validateContact({ ...ok, services: ["기타"], other_service: "브로슈어" })).toEqual({});
    expect(validateContact({ ...ok, reference_url: "javascript:alert(1)" }).reference_url).toBeDefined();
    expect(validateContact({ ...ok, reference_url: "example.com" }).reference_url).toBeDefined();
    expect(validateContact({ ...ok, reference_url: "https://example.com/a" })).toEqual({});
  });

  it("폼 읽기: 7종 밖의 값·중복은 버리고, '기타'를 고르지 않으면 기타 내용은 비운다, 동의는 체크만", () => {
    const fd = new FormData();
    fd.set("company_name", "  합성 업체 ");
    for (const v of ["홈페이지 제작", "홈페이지 제작", "AI 영상", "로고 제작"]) fd.append("services", v);
    fd.set("other_service", "무시됨");
    fd.set("privacy_consent", "on");
    const r = readContactForm(fd);
    expect(r.company_name).toBe("합성 업체");
    expect(r.services).toEqual(["홈페이지 제작", "로고 제작"]);
    expect(r.other_service).toBe("");
    expect(r.privacy_consent).toBe(true);
  });

  it("카드 미리 선택은 기존 선택을 지우지 않고 더한다(화면 순서 유지)", () => {
    expect(mergePreset(["로고 제작"], ["쇼츠·릴스 영상", "광고·상품 이미지"])).toEqual(["쇼츠·릴스 영상", "로고 제작", "광고·상품 이미지"]);
    expect(mergePreset(["홈페이지 제작"], ["홈페이지 제작"])).toEqual(["홈페이지 제작"]);
    expect(SERVICE_OPTIONS).toHaveLength(7);
  });
});
