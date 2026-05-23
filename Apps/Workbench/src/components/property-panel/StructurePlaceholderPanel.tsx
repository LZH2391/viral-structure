type StructurePlaceholderPanelProps = {
  title: string;
  capabilityId: string;
  description: string;
  inputs: string[];
  outputs: string[];
};

export function StructurePlaceholderPanel({
  title,
  capabilityId,
  description,
  inputs,
  outputs,
}: StructurePlaceholderPanelProps) {
  return (
    <section className="property-section agent-run-panel structure-placeholder-panel">
      <div className="section-heading">Agent</div>
      <div className="agent-capability-row">
        <div>
          <strong>{capabilityId}</strong>
          <span>占位中 / 后端未接入</span>
        </div>
        <button className="primary-button" type="button" disabled>
          待接入
        </button>
      </div>
      <div className="detail-hint">
        <div>{title}</div>
        <div>{description}</div>
      </div>
      <div className="structure-placeholder-grid">
        <div className="structure-placeholder-block">
          <strong>计划输入</strong>
          {inputs.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
        <div className="structure-placeholder-block">
          <strong>计划输出</strong>
          {outputs.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </div>
    </section>
  );
}
