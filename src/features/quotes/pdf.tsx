import { join } from "node:path";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
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

const s = StyleSheet.create({
  page: { fontFamily: "Pretendard", fontSize: 9.5, paddingTop: 40, paddingBottom: 56, paddingHorizontal: 40, lineHeight: 1.45 },
  draftMark: {
    position: "absolute",
    top: 300,
    left: 120,
    fontSize: 72,
    color: "#d0d0d0",
    transform: "rotate(-30deg)",
    fontWeight: 700,
  },
  title: { fontSize: 22, fontWeight: 700, textAlign: "center", letterSpacing: 8, marginBottom: 12 },
  meta: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  parties: { flexDirection: "row", gap: 12, marginBottom: 12 },
  box: { flex: 1, border: "1pt solid #888", padding: 8 },
  boxTitle: { fontWeight: 700, marginBottom: 4 },
  totalLine: { fontSize: 12, fontWeight: 700, marginBottom: 8, padding: 8, backgroundColor: "#f2f2f2" },
  tableHead: { flexDirection: "row", borderBottom: "1pt solid #333", borderTop: "1pt solid #333", paddingVertical: 4, fontWeight: 700 },
  row: { flexDirection: "row", borderBottom: "0.5pt solid #bbb", paddingVertical: 4 },
  cNo: { width: "6%", textAlign: "center" },
  cName: { width: "44%", paddingRight: 6 },
  cQty: { width: "12%", textAlign: "right", paddingRight: 6 },
  cPrice: { width: "18%", textAlign: "right", paddingRight: 6 },
  cAmount: { width: "20%", textAlign: "right" },
  desc: { color: "#555", fontSize: 8.5 },
  sums: { marginTop: 10, marginLeft: "50%" },
  sumRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  sumTotal: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderTop: "1pt solid #333", fontWeight: 700 },
  section: { marginTop: 14 },
  sectionTitle: { fontWeight: 700, marginBottom: 3 },
  footer: { position: "absolute", top: 841.89 - 36, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: "#666" },
});

const won = (n: number) => `${formatWon(n)}원`;

export function QuotePdf({ doc }: { doc: QuoteDocument }) {
  const sup = doc.supplier;
  const supLines = [
    sup.representative && `대표: ${sup.representative}`,
    sup.businessNumber && `사업자등록번호: ${sup.businessNumber}`,
    sup.address,
    [sup.phone, sup.email].filter(Boolean).join(" · ") || null,
  ].filter(Boolean) as string[];
  const draft = doc.status === "draft";

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
        <View style={s.meta}>
          <Text>견적 번호: {doc.quoteNumber ?? "초안 (번호 없음)"}</Text>
          <Text>
            작성일: {doc.issueDate ?? "-"}
            {"   "}유효기간: {doc.validUntil ?? "-"}
          </Text>
        </View>
        <View style={s.parties}>
          <View style={s.box}>
            <Text style={s.boxTitle}>받는 분</Text>
            <Text>{doc.customer.name} 귀하</Text>
            <Text style={s.desc}>{doc.projectTitle}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.boxTitle}>공급자</Text>
            <Text>{sup.legalName}</Text>
            {supLines.map((l) => (
              <Text key={l} style={s.desc}>
                {l}
              </Text>
            ))}
          </View>
        </View>
        <Text style={s.totalLine}>
          합계 금액: {won(doc.totalWon)} ({TAX_MODE_LABELS[doc.taxMode]}
          {doc.taxMode !== "NO_TAX" ? `, 세율 ${formatTaxRate(doc.taxRateBasisPoints)}%` : ""})
        </Text>

        <View style={s.tableHead} fixed>
          <Text style={s.cNo}>No</Text>
          <Text style={s.cName}>항목</Text>
          <Text style={s.cQty}>수량</Text>
          <Text style={s.cPrice}>단가</Text>
          <Text style={s.cAmount}>금액</Text>
        </View>
        {doc.items.map((it) => (
          <View key={it.position} style={s.row} wrap={false}>
            <Text style={s.cNo}>{it.position + 1}</Text>
            <View style={s.cName}>
              <Text>{it.name}</Text>
              {it.description && <Text style={s.desc}>{it.description}</Text>}
            </View>
            <Text style={s.cQty}>{formatQuantity(it.quantityHundredths)}</Text>
            <Text style={s.cPrice}>{formatWon(it.unitPriceWon)}</Text>
            <Text style={s.cAmount}>{formatWon(it.lineAmountWon)}</Text>
          </View>
        ))}

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

        {doc.paymentTerms && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>지급 조건</Text>
            <Text>{doc.paymentTerms}</Text>
          </View>
        )}
        {doc.notes && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>비고</Text>
            <Text>{doc.notes}</Text>
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
