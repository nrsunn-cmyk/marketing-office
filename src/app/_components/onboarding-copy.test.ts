import { describe, expect, it } from "vitest";
import { logoPrefillNote, ONBOARDING_COPY } from "./onboarding-copy";

describe("로고 입력 안내 고르기 (UX-SCENARIO-AUDIT-05 C1)", () => {
  it("지난 입력이 있으면 프로필 유무와 상관없이 '지난번 입력'", () => {
    expect(logoPrefillNote({ hasLastInput: true, hasProfile: true })).toBe(ONBOARDING_COPY.logoPrefillLast);
    expect(logoPrefillNote({ hasLastInput: true, hasProfile: false })).toBe(ONBOARDING_COPY.logoPrefillLast);
  });
  it("처음이고 프로필이 있으면 '회사 프로필에서 미리 채움'", () => {
    expect(logoPrefillNote({ hasLastInput: false, hasProfile: true })).toBe(ONBOARDING_COPY.logoPrefillProfile);
  });
  it("처음이고 프로필이 없으면 '미리 채웠다'고 말하지 않는다", () => {
    const note = logoPrefillNote({ hasLastInput: false, hasProfile: false });
    expect(note).toBe(ONBOARDING_COPY.logoPrefillNoProfile);
    expect(note).not.toContain("미리 채웠습니다");
  });
});

describe("처음 설정 탭 제목 (C4)", () => {
  it("/settings 탭 제목과 다르다", () => {
    expect(ONBOARDING_COPY.setupDocTitle).not.toBe("업무실 설정 · 마케팅 업무실");
  });
});

describe("자동 연결 안내 (PROJECT-PROFILE-AUTOLINK-FRONT-01, 주인님 결정 C1-2)", () => {
  it("프로필을 나중에 저장하면 연결된다고 말하고, '연결되지 않는다'·'먼저 저장해야'는 말하지 않는다", () => {
    const { profileStepNote, noProfileBeforeProject, logoPrefillNoProfile } = ONBOARDING_COPY;
    for (const s of [profileStepNote, noProfileBeforeProject, logoPrefillNoProfile]) {
      expect(s).not.toContain("연결되지 않");
      expect(s).not.toContain("만들기 전에 저장해야");
    }
    expect(noProfileBeforeProject).toContain("자동으로 연결됩니다");
    expect(logoPrefillNoProfile).toContain("저장하면 연결됩니다");
  });
});
