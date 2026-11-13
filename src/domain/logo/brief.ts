/**
 * 로고 브리프·이미지 생성 프롬프트 (입력 조합형, F03 처리 A).
 *
 * 원칙:
 * - 같은 입력이면 항상 같은 결과를 낸다(결정적).
 * - 입력에 없는 사실(성과·수상·고객 수 등)을 만들어 넣지 않는다.
 * - 비어 있는 항목은 지어내지 않고 `missingInformation`으로 알려 준다.
 * - 입력 문자열은 데이터로만 다룬다. 줄바꿈을 한 줄로 합쳐 프롬프트 구조를 바꾸지 못하게 한다.
 */

export const LOGO_TEMPLATE_VERSION = "logo-template@1";

export interface LogoBriefInput {
  companyName: string;
  industry?: string | null;
  description?: string | null;
  mainCustomers?: string | null;
  strengths?: string[];
  /** 원하는 분위기·톤 (예: 신뢰감, 친근함) */
  preferredStyles?: string[];
  colors?: string[];
  references?: string[];
  /** 피해야 할 요소 */
  forbidden?: string[];
  extraNotes?: string | null;
}

export type LogoField = Exclude<keyof LogoBriefInput, "companyName" | "extraNotes">;

export const LOGO_FIELD_LABELS: Record<LogoField, string> = {
  industry: "업종",
  description: "회사 설명",
  mainCustomers: "주요 고객",
  strengths: "강점",
  preferredStyles: "원하는 분위기",
  colors: "선호 색상",
  references: "참고 로고·자료",
  forbidden: "피해야 할 요소",
};

/** 결과 품질에 영향이 커서 비어 있으면 질문해야 하는 항목 */
const RECOMMENDED_FIELDS: LogoField[] = [
  "industry",
  "description",
  "mainCustomers",
  "strengths",
  "preferredStyles",
  "colors",
  "references",
  "forbidden",
];

export interface MissingInformation {
  field: LogoField;
  label: string;
}

export interface LogoBriefResult {
  brief: string;
  imagePrompt: string;
  constraints: string[];
  missingInformation: MissingInformation[];
  generator: { mode: "template"; templateVersion: typeof LOGO_TEMPLATE_VERSION };
}

export type LogoBriefOutcome =
  | { ok: true; result: LogoBriefResult }
  | { ok: false; code: "COMPANY_NAME_REQUIRED"; message: string };

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function cleanList(list: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list ?? []) {
    const v = clean(raw);
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

export function buildLogoBrief(input: LogoBriefInput): LogoBriefOutcome {
  const companyName = clean(input.companyName);
  if (!companyName) {
    return { ok: false, code: "COMPANY_NAME_REQUIRED", message: "회사명을 입력해 주세요." };
  }

  const values = {
    industry: clean(input.industry),
    description: clean(input.description),
    mainCustomers: clean(input.mainCustomers),
    strengths: cleanList(input.strengths),
    preferredStyles: cleanList(input.preferredStyles),
    colors: cleanList(input.colors),
    references: cleanList(input.references),
    forbidden: cleanList(input.forbidden),
  };
  const extraNotes = clean(input.extraNotes);

  const isEmpty = (f: LogoField) => {
    const v = values[f];
    return Array.isArray(v) ? v.length === 0 : v === "";
  };
  const missingInformation = RECOMMENDED_FIELDS.filter(isEmpty).map((field) => ({
    field,
    label: LOGO_FIELD_LABELS[field],
  }));

  const join = (list: string[]) => list.join(", ");

  const briefLines = [`# ${companyName} 로고 브리프`, "", "## 회사"];
  briefLines.push(`- 회사명: ${companyName}`);
  if (values.industry) briefLines.push(`- 업종: ${values.industry}`);
  if (values.description) briefLines.push(`- 회사 설명: ${values.description}`);
  if (values.mainCustomers) briefLines.push(`- 주요 고객: ${values.mainCustomers}`);
  if (values.strengths.length) briefLines.push(`- 강점: ${join(values.strengths)}`);

  const designLines: string[] = [];
  if (values.preferredStyles.length) designLines.push(`- 원하는 분위기: ${join(values.preferredStyles)}`);
  if (values.colors.length) designLines.push(`- 선호 색상: ${join(values.colors)}`);
  if (values.references.length) designLines.push(`- 참고: ${join(values.references)}`);
  if (values.forbidden.length) designLines.push(`- 피해야 할 요소: ${join(values.forbidden)}`);
  if (extraNotes) designLines.push(`- 추가 요청: ${extraNotes}`);
  if (designLines.length) briefLines.push("", "## 디자인 방향", ...designLines);

  if (missingInformation.length) {
    briefLines.push("", "## 확인이 필요한 정보", ...missingInformation.map((m) => `- ${m.label}`));
  }

  const promptParts = [`'${companyName}' 로고 디자인`];
  if (values.industry) promptParts.push(`업종: ${values.industry}`);
  if (values.description) promptParts.push(`회사 설명: ${values.description}`);
  if (values.mainCustomers) promptParts.push(`주요 고객: ${values.mainCustomers}`);
  if (values.strengths.length) promptParts.push(`강점: ${join(values.strengths)}`);
  if (values.preferredStyles.length) promptParts.push(`분위기: ${join(values.preferredStyles)}`);
  if (values.colors.length) promptParts.push(`색상: ${join(values.colors)}`);
  if (values.references.length) promptParts.push(`참고: ${join(values.references)}`);
  if (values.forbidden.length) promptParts.push(`제외할 요소: ${join(values.forbidden)}`);
  if (extraNotes) promptParts.push(`추가 요청: ${extraNotes}`);

  const constraints = [`회사명 표기는 '${companyName}' 그대로 사용`];
  for (const f of values.forbidden) constraints.push(`사용 금지: ${f}`);

  return {
    ok: true,
    result: {
      brief: briefLines.join("\n"),
      imagePrompt: promptParts.join(". ") + ".",
      constraints,
      missingInformation,
      generator: { mode: "template", templateVersion: LOGO_TEMPLATE_VERSION },
    },
  };
}
