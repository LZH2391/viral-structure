import type { ContentProfile, ShotBoundaryAnalysisArtifact } from "../types";
import { CommerceBriefPanel } from "./property-panel/CommerceBriefPanel";

export function CreateInputApp({
  embedded = false,
  onBack,
  commerceBrief,
  profile,
  onProfileChange,
  onGeneratePlan,
}: {
  embedded?: boolean;
  onBack?: () => void;
  commerceBrief?: ShotBoundaryAnalysisArtifact["commerceBrief"] | null;
  profile: ContentProfile;
  onProfileChange: (field: keyof ContentProfile, value: string) => void;
  onGeneratePlan: () => void;
}) {
  return (
    <div className={embedded ? "create-shell embedded-view" : "create-shell"}>
      {embedded ? (
        <header className="embedded-view-header">
          <div>
            <strong>创作输入</strong>
            <div className="detail-hint">查看样例总结并填写新内容输入</div>
          </div>
          <div className="top-actions">
            <button className="ghost-button" type="button" onClick={onBack}>返回工作台</button>
          </div>
        </header>
      ) : null}
      <main className="create-grid">
        <section className="create-panel">
          <CommerceBriefPanel
            commerceBrief={commerceBrief ?? null}
            profile={profile}
            onProfileChange={onProfileChange}
            onGeneratePlan={onGeneratePlan}
            standalone
          />
        </section>
      </main>
    </div>
  );
}
