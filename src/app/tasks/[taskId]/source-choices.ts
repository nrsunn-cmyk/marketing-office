import type { BriefSourceOptions } from "@/features/brief/server";

/** 근거 선택 목록의 한 항목. value: "profile:<versionId>:<field>" · "asset:<id>" · "research:<id>" */
export interface SourceChoice {
  value: string;
  label: string;
}
export interface SourceChoiceGroup {
  label: string;
  choices: SourceChoice[];
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * 브리프 '근거 연결하기'의 선택 목록(묶음별). 서버가 준 후보(getContentBriefFor 의 options)만 쓴다.
 * - 외부 출처: 원문을 아직 확인하지 않은 출처는 이름 뒤에 '(확인 전)'을 붙인다. 고를 수는 있다(SOURCES-UI-01)
 */
export function sourceChoiceGroups(options: BriefSourceOptions): SourceChoiceGroup[] {
  const profile = options.profile;
  return [
    {
      label: profile ? `회사 프로필 ${profile.version}번 버전` : "회사 프로필",
      choices: (profile?.fields ?? []).map((p) => ({ value: `profile:${profile!.id}:${p.field}`, label: `${p.label}: ${cut(p.value, 60)}` })),
    },
    { label: "프로젝트 자료", choices: options.assets.map((a) => ({ value: `asset:${a.id}`, label: a.label.slice(0, 80) })) },
    {
      label: "외부 출처",
      choices: options.research.map((r) => ({
        value: `research:${r.id}`,
        label: `${cut(r.label, 80)}${r.reviewStatus === "unverified" ? " (확인 전)" : ""}`,
      })),
    },
  ];
}
