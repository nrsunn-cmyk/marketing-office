/**
 * P3D-UI-CONNECT-01 영상 파일 직접 첨부 흐름(Backend P3D 4절): 미리 거르기 → 예약 → 서명 주소 XHR PUT(실제 바이트) → 확정.
 * 올리기 실패·취소면 예약을 닫는다(cancelVideoUpload). P3-c 업로드 구조(putToSignedUrl·단계·DA_COPY 업로드 문구)를 그대로 쓴다.
 */
import type { VideoStepResult } from "@/features/video-plans/actions";
import { DA_COPY } from "./design-assets-model";
import { putToSignedUrl, type PutJob, type UploadPhase } from "./design-upload";
import { VP_COPY, guessVideoMime, precheckVideoFile } from "./video-plan-model";

type Ticket = { uploadId: string; path: string; uploadUrl: string; mime: string; expiresAt: string };
export interface VideoUploadActions {
  start: (raw: unknown) => Promise<VideoStepResult<Ticket>>;
  finish: (planId: string, revision: number, path: string, raw: unknown) => Promise<VideoStepResult<{ revision: number }>>;
  cancel: (uploadId: string) => Promise<VideoStepResult<null>>;
}

export async function runVideoUpload(
  input: { planId: string; revision: number; file: Blob & { name: string; size: number; type: string }; changeNote: string; limitBytes?: number },
  deps: { actions: VideoUploadActions; put?: typeof putToSignedUrl; apiKey?: string },
  onPhase: (p: UploadPhase) => void,
  onJob: (j: PutJob | null) => void = () => {},
): Promise<UploadPhase> {
  const end = (p: UploadPhase) => (onPhase(p), p);
  const bad = precheckVideoFile(input.file, input.limitBytes);
  if (bad) return end({ k: "error", text: bad });
  const mime = guessVideoMime(input.file.name, input.file.type);
  const prep = await deps.actions.start({ planId: input.planId, fileName: input.file.name, size: input.file.size, mime });
  if (!prep.ok) return end({ k: "error", text: prep.message });
  onPhase({ k: "uploading", loaded: 0, total: input.file.size });
  const job = (deps.put ?? putToSignedUrl)({ url: prep.data.uploadUrl, file: input.file, mime: prep.data.mime, expiresAt: prep.data.expiresAt, apiKey: deps.apiKey }, (loaded, total) =>
    onPhase({ k: "uploading", loaded, total }),
  );
  onJob(job);
  const put = await job.promise;
  onJob(null);
  if (!put.ok) {
    await deps.actions.cancel(prep.data.uploadId); // 예약을 닫는다(동시 대기 5건 한도를 비움)
    return end(put.reason === "cancelled" ? { k: "idle" } : { k: "error", text: put.reason === "expired" ? DA_COPY.uploadErrExpired : DA_COPY.uploadErrNetwork });
  }
  onPhase({ k: "confirming" });
  const r = await deps.actions.finish(input.planId, input.revision, prep.data.path, { uploadId: prep.data.uploadId, changeNote: input.changeNote });
  return end(r.ok ? { k: "done", text: VP_COPY.attachedOk } : { k: "error", text: r.message });
}
