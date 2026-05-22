import type { ContentProfile, ShotBoundaryAnalysisArtifact } from "../../types";
import { DetailRow } from "./SharedRows";

export function CommerceBriefPanel({
  commerceBrief,
  profile,
  onProfileChange,
  onGeneratePlan,
  standalone = false,
}: {
  commerceBrief?: ShotBoundaryAnalysisArtifact["commerceBrief"];
  profile: ContentProfile;
  onProfileChange: (field: keyof ContentProfile, value: string) => void;
  onGeneratePlan: () => void;
  standalone?: boolean;
}) {
  const hasCommerceBrief = Boolean(
    commerceBrief?.sellingObject
    || commerceBrief?.proofApproach
    || commerceBrief?.promisedOutcome
    || commerceBrief?.persuasionTarget
    || commerceBrief?.conversionAction
    || commerceBrief?.uncertainties?.length,
  );

  return (
    <section className={`property-section ${standalone ? "is-standalone-section" : ""}`}>
      <div className="section-heading">样例总结 / 新内容</div>
      <div className={`detail-block commerce-brief-panel ${standalone ? "is-standalone" : ""}`}>
        {hasCommerceBrief ? (
          <>
            <DetailRow label="卖什么" value={commerceBrief?.sellingObject || "待分析"} />
            <DetailRow label="如何证明" value={commerceBrief?.proofApproach || "待分析"} />
            <DetailRow label="承诺结果" value={commerceBrief?.promisedOutcome || "待分析"} />
            <DetailRow label="打动谁/什么" value={commerceBrief?.persuasionTarget || "待分析"} />
            <DetailRow label="转化动作" value={commerceBrief?.conversionAction || "未观察到明显转化动作"} />
            <DetailRow label="不确定点" value={commerceBrief?.uncertainties?.length ? commerceBrief.uncertainties.join("；") : "无明显不确定点"} />
          </>
        ) : (
          <div className="detail-hint">待分析：运行 shot-boundary 后会在这里展示样例带货总结。</div>
        )}
        <form
          className="profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            onGeneratePlan();
          }}
        >
          <label>
            <span>新商品/主题</span>
            <input value={profile.topic} onChange={(event) => onProfileChange("topic", event.currentTarget.value)} />
          </label>
          <label>
            <span>卖点</span>
            <textarea rows={3} value={profile.sellingPoints} onChange={(event) => onProfileChange("sellingPoints", event.currentTarget.value)} />
          </label>
          <label>
            <span>目标人群</span>
            <input value={profile.audience} onChange={(event) => onProfileChange("audience", event.currentTarget.value)} />
          </label>
          <label>
            <span>平台/场景</span>
            <input value={profile.platform} onChange={(event) => onProfileChange("platform", event.currentTarget.value)} />
          </label>
          <label>
            <span>期望时长</span>
            <input value={profile.duration} onChange={(event) => onProfileChange("duration", event.currentTarget.value)} />
          </label>
          <label>
            <span>表达偏好</span>
            <input value={profile.tone} onChange={(event) => onProfileChange("tone", event.currentTarget.value)} />
          </label>
          <button className="primary-button" type="submit">生成迁移方案</button>
        </form>
      </div>
    </section>
  );
}
