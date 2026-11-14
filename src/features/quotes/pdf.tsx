import { join } from "node:path";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { koreanWonPhrase } from "@/domain/quote/korean-amount";
import { formatQuantity, formatTaxRate, formatWon } from "@/domain/quote/parse";
import { TAX_MODE_LABELS, type QuoteDocument } from "./document";

/**
 * 견적서 PDF (V02). 브라우저 없이 Node에서 같은 입력이면 같은 내용의 PDF를 만든다.
 * 글꼴: Pretendard (SIL OFL 1.1) — 한글 전체 글자를 PDF에 넣는다.
 */

const FONT_DIR = join(process.cwd(), "node_modules", "pretendard", "dist", "public", "static", "alternative");
let fontsReady = false;

function registerFonts() {
  if (fontsReady) return;
  Font.register({
    family: "Pretendard",
    fonts: [
      { src: join(FONT_DIR, "Pretendard-Regular.ttf"), fontWeight: 400 },
      { src: join(FONT_DIR, "Pretendard-Bold.ttf"), fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback(koreanBreakPoints);
  fontsReady = true;
}

const HANGUL = /[ㄱ-ㆎ가-힣]/;
/** 줄 첫머리에 오면 안 되는 문장 부호 */
const NO_LINE_START = /^[.,!?%)\]}:;·…'"」』〉》]/;

/**
 * 한글 줄바꿈 지점. 띄어쓰기 없는 긴 한글 단어도 글자 사이에서 줄을 바꿀 수 있게 하되,
 * 숫자·영문 덩어리("50%", "Q-2026")는 쪼개지 않고, 문장 부호가 줄 첫머리에 오지 않게 앞 글자에 붙인다.
 * 각 조각 뒤에 빈 문자열을 넣어 하이픈 없이 줄을 바꾼다.
 */
export function koreanBreakPoints(word: string): string[] {
  if (!HANGUL.test(word)) return [word];
  const tokens = word.match(/[ㄱ-ㆎ가-힣]|[^ㄱ-ㆎ가-힣]+/g) ?? [word];
  const parts: string[] = [];
  for (const t of tokens) {
    if (parts.length > 0 && NO_LINE_START.test(t)) {
      // 문장 부호로 시작하는 덩어리는 앞 조각에 붙인다
      parts[parts.length - 1] += t;
    } else {
      parts.push(t);
    }
  }
  return parts.flatMap((p) => [p, ""]).slice(0, -1);
}

/*
 * 표준 견적서 배치 (Plan/견적서양식/표준견적서-샘플.md)
 * 위: 제목 → 견적 정보·받는 분(왼쪽) | 공급자 표(오른쪽) → 합계금액 띠(한글·숫자)
 * 가운데: 품목 표(쪽마다 머리 반복, 행 쪼개짐 없음) → 공급가액·세액·합계
 * 아래: 특기사항(결제 조건·입금 계좌·비고·유효기간) → 쪽 번호
 */
const LINE = "#334155";
const s = StyleSheet.create({
  page: { fontFamily: "Pretendard", fontSize: 9.2, paddingTop: 36, paddingBottom: 52, paddingHorizontal: 36, lineHeight: 1.4, color: "#0f172a" },
  draftMark: { position: "absolute", top: 300, left: 120, fontSize: 72, color: "#d0d0d0", transform: "rotate(-30deg)", fontWeight: 700 },
  title: { fontSize: 22, fontWeight: 700, textAlign: "center", letterSpacing: 10, marginBottom: 14 },
  top: { flexDirection: "row", gap: 10, marginBottom: 10 },
  left: { flex: 1, justifyContent: "space-between" },
  metaRow: { flexDirection: "row", marginBottom: 2 },
  metaLabel: { width: 52, color: "#475569" },
  customer: { fontSize: 13, fontWeight: 700, marginTop: 6, borderBottom: `1pt solid ${LINE}`, paddingBottom: 3 },
  greeting: { marginTop: 6, color: "#334155" },
  supplier: { width: "56%", border: `1pt solid ${LINE}` },
  supplierHead: { backgroundColor: "#f1f5f9", borderBottom: `1pt solid ${LINE}`, paddingVertical: 3, textAlign: "center", fontWeight: 700 },
  sRow: { flexDirection: "row", borderBottom: "0.5pt solid #94a3b8", minHeight: 18 },
  sRowLast: { flexDirection: "row", minHeight: 18 },
  sLabel: { width: 54, backgroundColor: "#f8fafc", borderRight: "0.5pt solid #94a3b8", paddingHorizontal: 4, paddingVertical: 3, fontWeight: 700, fontSize: 8.5 },
  sValue: { flex: 1, paddingHorizontal: 5, paddingVertical: 3 },
  sValueSplit: { flex: 1, paddingHorizontal: 5, paddingVertical: 3, borderRight: "0.5pt solid #94a3b8" },
  seal: { color: "#b91c1c", fontWeight: 700 },
  totalBar: { flexDirection: "row", justifyContent: "space-between", border: `1.5pt solid ${LINE}`, backgroundColor: "#f1f5f9", paddingVertical: 7, paddingHorizontal: 10, marginBottom: 10 },
  totalBarText: { fontSize: 11.5, fontWeight: 700 },
  tableHead: { flexDirection: "row", backgroundColor: "#f1f5f9", borderTop: `1pt solid ${LINE}`, borderBottom: `1pt solid ${LINE}`, paddingVertical: 4, fontWeight: 700 },
  row: { flexDirection: "row", borderBottom: "0.5pt solid #cbd5e1", paddingVertical: 4 },
  cNo: { width: "5%", textAlign: "center" },
  cName: { width: "27%", paddingRight: 4 },
  cSpec: { width: "22%", paddingRight: 4, color: "#334155" },
  cQty: { width: "9%", textAlign: "right", paddingRight: 4 },
  cPrice: { width: "16%", textAlign: "right", paddingRight: 4 },
  cAmount: { width: "21%", textAlign: "right", paddingRight: 2 },
  sums: { marginTop: 8, marginLeft: "52%", border: `1pt solid ${LINE}` },
  sumRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, paddingHorizontal: 8, borderBottom: "0.5pt solid #cbd5e1" },
  sumTotal: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, paddingHorizontal: 8, backgroundColor: "#f1f5f9", fontWeight: 700, fontSize: 10.5 },
  notes: { marginTop: 14, border: "0.5pt solid #94a3b8", paddingBottom: 3 },
  notesHead: { backgroundColor: "#f8fafc", borderBottom: "0.5pt solid #94a3b8", paddingVertical: 3, paddingHorizontal: 6, fontWeight: 700 },
  noteRow: { flexDirection: "row", paddingTop: 3, paddingHorizontal: 6 },
  noteRowNext: { flexDirection: "row", paddingHorizontal: 6 },
  noteLabel: { width: 60, color: "#475569", fontWeight: 700 },
  noteValue: { flex: 1 },
  footer: { position: "absolute", top: 841.89 - 34, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: "#64748b" },
});

const won = (n: number) => `${formatWon(n)}원`;
const dash = (v: string | null | undefined) => (v && v.trim() ? v : "-");

export function QuotePdf({ doc }: { doc: QuoteDocument }) {
  const sup = doc.supplier;
  const draft = doc.status === "draft";
  const inclusive = doc.taxMode === "INCLUSIVE";
  const notes: Array<[string, string]> = [];
  if (doc.paymentTerms) notes.push(["결제 조건", doc.paymentTerms]);
  if (sup.bankAccount) notes.push(["입금 계좌", sup.bankAccount]);
  if (doc.validUntil) notes.push(["유효기간", `${doc.validUntil}까지 유효합니다.`]);
  if (doc.notes) notes.push(["비고", doc.notes]);

  return (
    <Document title={`견적서 ${doc.quoteNumber ?? "(초안)"}`} author={sup.legalName} language="ko">
      <Page size="A4" style={s.page}>
        {/* 쪽마다 반복되는 아래쪽 줄. 본문보다 먼저 두어야 모든 쪽에 그려진다. */}
        <View style={s.footer} fixed>
          <Text>
            {sup.legalName} · {doc.quoteNumber ?? "초안"}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
        {draft && (
          <Text style={s.draftMark} fixed>
            초안
          </Text>
        )}

        <Text style={s.title}>견 적 서</Text>

        <View style={s.top}>
          <View style={s.left}>
            <View>
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>견적번호</Text>
                <Text>{doc.quoteNumber ?? "초안 (번호 없음)"}</Text>
              </View>
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>견적일자</Text>
                <Text>{dash(doc.issueDate)}</Text>
              </View>
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>유효기간</Text>
                <Text>{dash(doc.validUntil)}</Text>
              </View>
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>건명</Text>
                <Text>{doc.projectTitle}</Text>
              </View>
            </View>
            <View>
              <Text style={s.customer}>{doc.customer.name} 귀하</Text>
              <Text style={s.greeting}>아래와 같이 견적합니다.</Text>
            </View>
          </View>

          <View style={s.supplier}>
            <Text style={s.supplierHead}>공 급 자</Text>
            <View style={s.sRow}>
              <Text style={s.sLabel}>등록번호</Text>
              <Text style={s.sValue}>{dash(sup.businessNumber)}</Text>
            </View>
            <View style={s.sRow}>
              <Text style={s.sLabel}>상호</Text>
              <Text style={s.sValueSplit}>{sup.legalName}</Text>
              <Text style={s.sLabel}>대표자</Text>
              <Text style={s.sValue}>
                {dash(sup.representative)} <Text style={s.seal}>(인)</Text>
              </Text>
            </View>
            <View style={s.sRow}>
              <Text style={s.sLabel}>주소</Text>
              <Text style={s.sValue}>{dash(sup.address)}</Text>
            </View>
            <View style={s.sRow}>
              <Text style={s.sLabel}>업태</Text>
              <Text style={s.sValueSplit}>{dash(sup.businessType)}</Text>
              <Text style={s.sLabel}>종목</Text>
              <Text style={s.sValue}>{dash(sup.businessItem)}</Text>
            </View>
            <View style={s.sRow}>
              <Text style={s.sLabel}>연락처</Text>
              <Text style={s.sValue}>{dash([sup.phone, sup.email].filter(Boolean).join(" · "))}</Text>
            </View>
            <View style={s.sRowLast}>
              <Text style={s.sLabel}>담당자</Text>
              <Text style={s.sValue}>{dash(sup.contactPerson)}</Text>
            </View>
          </View>
        </View>

        <View style={s.totalBar}>
          <Text style={s.totalBarText}>합계금액 {koreanWonPhrase(doc.totalWon)}</Text>
          <Text style={s.totalBarText}>
            (₩{formatWon(doc.totalWon)} · {TAX_MODE_LABELS[doc.taxMode]}
            {doc.taxMode !== "NO_TAX" ? ` ${formatTaxRate(doc.taxRateBasisPoints)}%` : ""})
          </Text>
        </View>

        {/* 품목 표: 머리는 품목이 이어지는 쪽에만 반복한다(특기사항만 있는 쪽에는 나오지 않게 표 안에 둔다) */}
        <View>
          <View style={s.tableHead} fixed>
            <Text style={s.cNo}>No</Text>
            <Text style={s.cName}>품명</Text>
            <Text style={s.cSpec}>규격·설명</Text>
            <Text style={s.cQty}>수량</Text>
            <Text style={s.cPrice}>단가</Text>
            <Text style={s.cAmount}>{inclusive ? "금액(부가세 포함)" : "공급가액"}</Text>
          </View>
          {doc.items.map((it) => (
            <View key={it.position} style={s.row} wrap={false}>
              <Text style={s.cNo}>{it.position + 1}</Text>
              <Text style={s.cName}>{it.name}</Text>
              <Text style={s.cSpec}>{it.description ?? ""}</Text>
              <Text style={s.cQty}>{formatQuantity(it.quantityHundredths)}</Text>
              <Text style={s.cPrice}>{formatWon(it.unitPriceWon)}</Text>
              <Text style={s.cAmount}>{formatWon(it.lineAmountWon)}</Text>
            </View>
          ))}
        </View>

        <View style={s.sums} wrap={false}>
          <View style={s.sumRow}>
            <Text>공급가액</Text>
            <Text>{won(doc.subtotalWon)}</Text>
          </View>
          <View style={s.sumRow}>
            <Text>세액</Text>
            <Text>{won(doc.taxWon)}</Text>
          </View>
          <View style={s.sumTotal}>
            <Text>합계</Text>
            <Text>{won(doc.totalWon)}</Text>
          </View>
        </View>

        {notes.length > 0 && (
          // CR09: 특기사항이 길면 다음 쪽으로 이어진다(잘리거나 겹치지 않게). 줄마다 한 행으로 나눠
          // 쪽 경계에서 줄 단위로 넘어간다. 제목은 이어지는 쪽마다 반복하고, 첫 줄과 함께 놓일 공간이 없으면 다음 쪽에서 시작한다.
          <View style={s.notes}>
            <Text style={s.notesHead} minPresenceAhead={36} fixed>
              특기사항
            </Text>
            {notes.flatMap(([label, value]) =>
              value.split(/\r?\n/).map((line, i) => (
                <View key={`${label}-${i}`} style={i === 0 ? s.noteRow : s.noteRowNext}>
                  <Text style={s.noteLabel}>{i === 0 ? label : ""}</Text>
                  <Text style={s.noteValue} orphans={2} widows={2}>
                    {line || " "}
                  </Text>
                </View>
              )),
            )}
          </View>
        )}
      </Page>
    </Document>
  );
}

export async function renderQuotePdf(doc: QuoteDocument): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<QuotePdf doc={doc} />);
}
