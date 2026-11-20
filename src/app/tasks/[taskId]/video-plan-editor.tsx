"use client";

import { useId, useState } from "react";
import { ActionForm } from "../../_components/action-form";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import vp from "./video-plan.module.css";
import { notConnectedAction, type BriefAction } from "./production-brief-edit-form";
import {
  P3_COMMON_COPY,
  VIDEO_ASPECTS,
  VIDEO_ASPECT_KEYS,
  VIDEO_PLAN_LIMITS,
  VIDEO_PLAN_STATUSES,
  VIDEO_PLAN_STATUS_KEYS,
  VP_COPY,
  VP_LABELS,
  addScene,
  canAddScene,
  checkVideoPlan,
  countChars,
  counterText,
  durationSummary,
  moveScene,
  nearLimit,
  removeScene,
  sceneKey,
  toVideoPlanPayload,
  toggleAsset,
  type VideoAspect,
  type VideoAssetOption,
  type VideoPlanStatus,
  type VideoPlanView,
  type VideoSceneView,
} from "./video-plan-model";

/**
 * 영상 구성안 편집기(P3D-UI-PREP-01, 시안 Design/p3-production/video-plan.html).
 * 영상 제목·화면 비율 → 장면 목록(위로·아래로·제외, 장면 이름·길이·대사·자막·자산 연결) → 진행 상태 → 저장.
 * 저장은 구성안 전체를 숨은 칸 payload(JSON) 하나로 보낸다. 서버가 없으면 자리용 동작이 안내만 한다. 값은 자르지 않는다.
 */
/** hidden: 숨은 칸(기본 planId·revision). 만들기(첫 저장)는 productionBriefId 를 넘긴다 */
export function VideoPlanEditor({ plan, assets, action, hidden }: { plan: VideoPlanView; assets: VideoAssetOption[]; action?: BriefAction; hidden?: Record<string, string | number> }) {
  const id = useId();
  const [title, setTitle] = useState(plan.title);
  const [aspect, setAspect] = useState<VideoAspect>(plan.aspectRatio);
  const [status, setStatus] = useState<VideoPlanStatus>(plan.status);
  const [scenes, setScenes] = useState<VideoSceneView[]>(() => [...plan.scenes].sort((a, b) => a.sortOrder - b.sortOrder));
  const [touched, setTouched] = useState(false);
  const [note, setNote] = useState("");
  const assetIds = assets.map((a) => a.id);
  const issues = checkVideoPlan(title, scenes, assetIds);
  const L = VIDEO_PLAN_LIMITS;
  const change = (next: VideoSceneView[], msg = "") => {
    setTouched(true);
    setScenes(next);
    setNote(msg);
  };
  const setField = <K extends keyof VideoSceneView>(i: number, k: K, v: VideoSceneView[K]) => change(scenes.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const nTitle = countChars(title);
  const titleMsg = nTitle > L.title || touched ? issues.title : undefined;

  return (
    <ActionForm action={action ?? notConnectedAction} submitLabel={VP_COPY.save} pendingLabel={P3_COMMON_COPY.savePending} className={`${f.form} ${vp.vpForm}`}>
      {Object.entries(hidden ?? { planId: plan.id, revision: plan.revision }).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={String(v)} />
      ))}
      <input type="hidden" name="payload" value={JSON.stringify(toVideoPlanPayload({ title, aspectRatio: aspect, status, scenes }))} />

      <div className={vp.vpGrid2}>
        <div className={styles.field}>
          <div className={vp.vpFieldHead}>
            <label htmlFor={`${id}-title`}>
              {VP_LABELS.title} <span className={vp.vpReq}>(필수)</span>
            </label>
            <Counter id={`${id}-title-count`} n={nTitle} max={L.title} label={VP_LABELS.title} />
          </div>
          <input
            id={`${id}-title`}
            type="text"
            value={title}
            onChange={(e) => {
              setTouched(true);
              setTitle(e.target.value);
            }}
            required
            aria-required
            aria-invalid={titleMsg ? true : undefined}
            aria-describedby={`${id}-title-count${titleMsg ? ` ${id}-title-msg` : ""}`}
          />
          {titleMsg && (
            <span id={`${id}-title-msg`} className={styles.error}>
              {titleMsg}
            </span>
          )}
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-aspect`}>{VP_LABELS.aspect}</label>
          <select id={`${id}-aspect`} value={aspect} onChange={(e) => setAspect(e.target.value as VideoAspect)}>
            {VIDEO_ASPECT_KEYS.map((k) => (
              <option key={k} value={k}>
                {VIDEO_ASPECTS[k]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={vp.vpScenesHead}>
        <h4 className={vp.vpSubhead} id={`${id}-scenes-h`}>{`${VP_LABELS.scenesHeading} (${scenes.length} / ${L.scenesMax}장면)`}</h4>
        <span className={f.tag}>{durationSummary(scenes)}</span>
      </div>
      {issues.scenes && <p className={styles.error}>{issues.scenes}</p>}
      <ol className={vp.vpScenes} aria-labelledby={`${id}-scenes-h`}>
        {scenes.map((s, i) => (
          <SceneCard
            key={`${i}-${s.id ?? "new"}`}
            idBase={`${id}-s${i}`}
            s={s}
            i={i}
            count={scenes.length}
            assets={assets}
            issues={issues}
            touched={touched}
            onField={(k, v) => setField(i, k, v)}
            onMove={(dir) => change(moveScene(scenes, i, dir), `장면 순서를 ${dir < 0 ? "위로" : "아래로"} 옮겼습니다.`)}
            onRemove={() => change(removeScene(scenes, i), "")}
            onAsset={(aid, on) => setField(i, "assetIds", toggleAsset(s.assetIds, aid, on, assetIds))}
          />
        ))}
      </ol>
      {canAddScene(scenes) ? (
        <button type="button" className={`${styles.secondaryButton} ${f.touch}`} onClick={() => change(addScene(scenes), "")}>
          {VP_LABELS.addScene}
        </button>
      ) : (
        <p className={styles.muted} role="note">
          {VP_COPY.sceneLimitReached}
        </p>
      )}
      <p className={vp.vpSrOnly} role="status" aria-live="polite">
        {note}
      </p>

      <div className={styles.field}>
        <label htmlFor={`${id}-status`}>{VP_LABELS.status}</label>
        <select id={`${id}-status`} value={status} onChange={(e) => setStatus(e.target.value as VideoPlanStatus)}>
          {VIDEO_PLAN_STATUS_KEYS.map((k) => (
            <option key={k} value={k}>
              {VIDEO_PLAN_STATUSES[k]}
            </option>
          ))}
        </select>
      </div>
    </ActionForm>
  );
}

function Counter({ id, n, max, label }: { id: string; n: number; max: number; label: string }) {
  return (
    <>
      <span id={id} className={n > max ? `${vp.vpCount} ${vp.vpCountOver}` : vp.vpCount}>
        {counterText(n, max)}
      </span>
      <span className={vp.vpSrOnly} aria-live="polite">
        {nearLimit(n, max) ? `${label} ${counterText(n, max)}` : ""}
      </span>
    </>
  );
}

function SceneCard({
  idBase,
  s,
  i,
  count,
  assets,
  issues,
  touched,
  onField,
  onMove,
  onRemove,
  onAsset,
}: {
  idBase: string;
  s: VideoSceneView;
  i: number;
  count: number;
  assets: VideoAssetOption[];
  issues: Record<string, string>;
  touched: boolean;
  onField: <K extends keyof VideoSceneView>(k: K, v: VideoSceneView[K]) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onAsset: (id: string, on: boolean) => void;
}) {
  const L = VIDEO_PLAN_LIMITS;
  const name = `장면 ${i + 1} · ${s.sceneTitle || "이름 없음"}`;
  const hId = `${idBase}-h`;
  const msg = (k: Parameters<typeof sceneKey>[1], over: boolean) => (over || touched ? issues[sceneKey(i, k)] : undefined);
  const text = (k: "sceneTitle" | "narration" | "subtitle", label: string, max: number, multiline: boolean, required = false) => {
    const v = s[k];
    const n = countChars(v);
    const m = msg(k, n > max);
    const fid = `${idBase}-${k}`;
    const common = {
      id: fid,
      value: v,
      onChange: (e: { target: { value: string } }) => onField(k, e.target.value),
      required,
      "aria-required": required || undefined,
      "aria-invalid": m ? true : undefined,
      "aria-describedby": `${fid}-count${m ? ` ${fid}-msg` : ""}`,
    };
    return (
      <div className={styles.field}>
        <div className={vp.vpFieldHead}>
          <label htmlFor={fid}>
            {label} {required && <span className={vp.vpReq}>(필수)</span>}
          </label>
          <Counter id={`${fid}-count`} n={n} max={max} label={label} />
        </div>
        {multiline ? <textarea {...common} rows={k === "narration" ? 3 : 2} /> : <input type="text" {...common} />}
        {m && (
          <span id={`${fid}-msg`} className={styles.error}>
            {m}
          </span>
        )}
      </div>
    );
  };
  const durMsg = msg("durationSec", true);
  const assetMsg = issues[sceneKey(i, "assetIds")];
  return (
    <li className={vp.vpScene} aria-labelledby={hId}>
      <div className={vp.vpSceneHead}>
        <h5 id={hId} className={vp.vpSceneTitle}>
          {name}
        </h5>
        <div className={vp.vpTools} role="group" aria-label={`${name} 순서·제외`}>
          <button type="button" className={`${styles.secondaryButton} ${f.touch}`} disabled={i === 0} onClick={() => onMove(-1)} aria-label={`${name} ${VP_LABELS.up}`}>
            {VP_LABELS.up}
          </button>
          <button type="button" className={`${styles.secondaryButton} ${f.touch}`} disabled={i === count - 1} onClick={() => onMove(1)} aria-label={`${name} ${VP_LABELS.down}`}>
            {VP_LABELS.down}
          </button>
          <button type="button" className={`${styles.secondaryButton} ${f.touch}`} disabled={count <= 1} onClick={onRemove} aria-label={`${name} ${VP_LABELS.exclude}`}>
            {VP_LABELS.exclude}
          </button>
        </div>
      </div>
      <div className={vp.vpGrid2}>
        {text("sceneTitle", VP_LABELS.sceneTitle, L.sceneTitle, false, true)}
        <div className={styles.field}>
          <label htmlFor={`${idBase}-dur`}>{VP_LABELS.duration}</label>
          <input
            id={`${idBase}-dur`}
            type="number"
            inputMode="numeric"
            min={L.durationMin}
            max={L.durationMax}
            step={1}
            value={Number.isFinite(s.durationSec) ? s.durationSec : ""}
            onChange={(e) => onField("durationSec", e.target.value === "" ? Number.NaN : Number(e.target.value))}
            aria-invalid={durMsg ? true : undefined}
            aria-describedby={durMsg ? `${idBase}-dur-msg` : undefined}
          />
          {durMsg && (
            <span id={`${idBase}-dur-msg`} className={styles.error}>
              {durMsg}
            </span>
          )}
        </div>
      </div>
      {text("narration", VP_LABELS.narration, L.narration, true)}
      {text("subtitle", VP_LABELS.subtitle, L.subtitle, true)}
      <fieldset className={vp.vpAssets}>
        <legend>
          {VP_LABELS.assets} <span className={vp.vpCount}>{` ${s.assetIds.length}/${L.assetsPerScene}개`}</span>
        </legend>
        <div className={vp.vpAssetGrid}>
          {assets.map((a) => (
            <label key={a.id} className={vp.vpCheck}>
              <input type="checkbox" checked={s.assetIds.includes(a.id)} onChange={(e) => onAsset(a.id, e.target.checked)} />
              <span>{a.label}</span>
            </label>
          ))}
        </div>
        {assetMsg && <span className={styles.error}>{assetMsg}</span>}
      </fieldset>
    </li>
  );
}
