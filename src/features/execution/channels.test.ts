import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approvedChannelEndpoint } from "./channel-boundary";
import { dispatchExternalExecution, syncChannelMetrics } from "./channels";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), fetch: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({
  requireWorkspace: async () => ({ user: { userId: "test-user" } }),
}));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ rpc: mocks.rpc }),
}));

const endpoint = "https://provider.example.test/dispatch";
const metrics = "https://provider.example.test/metrics";

beforeEach(() => {
  vi.stubEnv("P4_CHANNEL_SIGNING_KEY", "a".repeat(64));
  vi.stubEnv("P4_CHANNEL_ALLOWED_ENDPOINTS", JSON.stringify({ crm: { dispatch: endpoint, metrics } }));
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("P4 서버 발신 정책", () => {
  it("채널과 요청 용도에 등록된 정확한 HTTPS 주소만 통과한다", () => {
    expect(approvedChannelEndpoint("crm", "dispatch", endpoint)).toBe(endpoint);
    expect(approvedChannelEndpoint("search_ad", "dispatch", endpoint)).toBeNull();
    expect(approvedChannelEndpoint("crm", "metrics", endpoint)).toBeNull();
    expect(approvedChannelEndpoint("crm", "dispatch", endpoint + "/other")).toBeNull();
    expect(approvedChannelEndpoint("crm", "dispatch", endpoint + "?token=sample")).toBeNull();
    vi.stubEnv("P4_CHANNEL_ALLOWED_ENDPOINTS", "{");
    expect(approvedChannelEndpoint("crm", "dispatch", endpoint)).toBeNull();
  });

  it("서버 증명 키가 없으면 DB 호출과 발신을 시작하지 않는다", async () => {
    vi.stubEnv("P4_CHANNEL_SIGNING_KEY", "");
    expect(await dispatchExternalExecution("test-job", 2)).toMatchObject({ ok: false });
    expect(await syncChannelMetrics("test-project", "crm")).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("저장 주소가 승인 목록과 다르면 발신 없이 실패를 기록한다", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: { revision: 3, channel: "crm", endpoint_url: "https://another.example.test/dispatch" },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: "test-job" }, error: null });
    expect(await dispatchExternalExecution("test-job", 2)).toMatchObject({ ok: false });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "p4_server_channel_call", expect.objectContaining({
      p_action: "finish",
      p_payload: JSON.stringify({ jobId: "test-job", revision: 3, success: false, externalUrl: null, errorCode: "destination_not_allowed" }),
    }));
  });

  it("성과 읽기에서 리디렉션을 막고 저장은 서버 증명으로 요청한다", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { metrics_url: metrics, secret_value: "synthetic-key", account_label: "시험 계정" },
      error: null,
    }).mockResolvedValueOnce({ data: "metric-id", error: null });
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({
      metricName: "조회수", value: 4, periodStart: "2026-11-21", periodEnd: "2026-11-22",
    })));
    expect(await syncChannelMetrics("test-project", "crm")).toEqual({ ok: true, data: { syncedCount: 1 } });
    expect(mocks.fetch).toHaveBeenCalledWith(metrics, expect.objectContaining({ method: "GET", redirect: "error" }));
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "p4_server_channel_call", expect.objectContaining({ p_action: "recordMetric" }));
  });
});
