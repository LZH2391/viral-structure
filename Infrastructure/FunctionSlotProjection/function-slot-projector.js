function buildFunctionSlotProjectionRows(artifact) {
  const analysis = artifact?.functionSlotAtomizationAnalysis ?? artifact;
  if (!analysis?.artifactId) {
    throw new Error("function slot atomization artifact is missing artifactId");
  }
  const artifactId = analysis.artifactId;
  const sampleVideoId = artifact?.sampleVideoId ?? analysis.sampleVideoId ?? null;
  const traceId = analysis.traceId ?? artifact?.trace?.traceId ?? null;
  const rows = emptyRows();

  rows.artifacts.push({
    artifactId,
    sampleVideoId,
    traceId,
    parentArtifactId: analysis.parentArtifactId ?? null,
    sourceScriptSegmentArtifactId: analysis.sourceScriptSegmentArtifactId ?? null,
    sourceRhythmStructureArtifactId: analysis.sourceRhythmStructureArtifactId ?? null,
    sourcePackagingStructureArtifactId: analysis.sourcePackagingStructureArtifactId ?? null,
    createdAt: analysis.createdAt ?? null,
    status: analysis.status ?? null,
  });

  pushArtifactSources(rows, analysis, artifactId);
  pushSlots(rows, analysis, artifactId);
  pushAtoms(rows, analysis, artifactId);
  pushBindings(rows, analysis, artifactId);
  pushRules(rows, analysis, artifactId);
  pushTemplates(rows, analysis, artifactId);

  return rows;
}

function emptyRows() {
  return {
    artifacts: [],
    slots: [],
    atoms: [],
    scriptAtoms: [],
    rhythmAtoms: [],
    packagingAtoms: [],
    bindings: [],
    bindingRefs: [],
    rules: [],
    templates: [],
    artifactSources: [],
    slotSourceRefs: [],
    atomSourceRefs: [],
  };
}

function pushArtifactSources(rows, analysis, artifactId) {
  const sources = [
    ["script-segment-analysis", analysis.sourceScriptSegmentArtifactId],
    ["rhythm-structure-analysis", analysis.sourceRhythmStructureArtifactId],
    ["packaging-structure-analysis", analysis.sourcePackagingStructureArtifactId],
    ["shot-boundary-analysis", analysis.sourceShotBoundaryArtifactId],
  ];
  for (const [sourceArtifactType, sourceArtifactId] of sources) {
    if (!sourceArtifactId) continue;
    rows.artifactSources.push({
      artifactId,
      sourceArtifactId,
      sourceArtifactType,
      sourceTraceId: null,
    });
  }
}

function pushSlots(rows, analysis, artifactId) {
  for (const slot of analysis.slotMap?.slots ?? []) {
    rows.slots.push({
      artifactId,
      slotId: slot.slotId,
      slotOrder: slot.slotOrder ?? null,
      slotType: slot.slotType ?? null,
      slotName: slot.slotName ?? null,
      viewerStateBefore: slot.viewerStateBefore ?? null,
      viewerStateAfter: slot.viewerStateAfter ?? null,
      persuasionTask: slot.persuasionTask ?? null,
      confidence: slot.confidence ?? null,
      needReview: boolToInt(slot.needReview),
    });
    pushSourceRefs(rows.slotSourceRefs, {
      artifactId,
      ownerIdKey: "slotId",
      ownerId: slot.slotId,
      sourceRefs: slot.sourceRefs,
    });
  }
}

function pushAtoms(rows, analysis, artifactId) {
  const atomSlotIndex = buildAtomSlotIndex(analysis);
  pushAtomType(rows, analysis.atomInventory?.scriptAtoms, artifactId, "script", atomSlotIndex);
  pushAtomType(rows, analysis.atomInventory?.rhythmAtoms, artifactId, "rhythm", atomSlotIndex);
  pushAtomType(rows, analysis.atomInventory?.packagingAtoms, artifactId, "packaging", atomSlotIndex);
}

function buildAtomSlotIndex(analysis) {
  const index = new Map();
  for (const slot of analysis.slotMap?.slots ?? []) {
    const slotId = slot.slotId ?? null;
    const slotType = slot.slotType ?? null;
    for (const atomId of slot.scriptAtomIds ?? []) index.set(atomId, { slotId, slotType });
    for (const atomId of slot.rhythmAtomIds ?? []) index.set(atomId, { slotId, slotType });
    for (const atomId of slot.packagingAtomIds ?? []) index.set(atomId, { slotId, slotType });
  }
  return index;
}

function pushAtomType(rows, atoms = [], artifactId, atomType, atomSlotIndex) {
  for (const atom of atoms ?? []) {
    const slotRef = atomSlotIndex.get(atom.id) ?? { slotId: null, slotType: atom.slot ?? null };
    rows.atoms.push({
      artifactId,
      atomId: atom.id,
      slotId: slotRef.slotId,
      slotType: slotRef.slotType,
      atomType,
      label: atom.label ?? null,
      functionText: atom.function ?? null,
      confidence: atom.confidence ?? null,
      needReview: boolToInt(atom.needReview),
      rawJson: json(projectedAtomRawJson(atom, atomType, slotRef)),
    });
    if (atomType === "script") {
      rows.scriptAtoms.push({
        artifactId,
        atomId: atom.id,
        claimType: atom.claimType ?? null,
        proofNeed: atom.proofNeed ?? null,
        mustKeepJson: json(atom.mustKeep ?? []),
        replaceableVariablesJson: json(atom.replaceableVariables ?? []),
      });
    } else if (atomType === "rhythm") {
      rows.rhythmAtoms.push({
        artifactId,
        atomId: atom.id,
        pace: atom.pace ?? null,
        densityType: atom.densityType ?? null,
        beatShape: atom.beatShape ?? null,
        avoidForJson: json(atom.avoidFor ?? []),
        syncPointsJson: json(atom.syncPoints ?? []),
      });
    } else if (atomType === "packaging") {
      rows.packagingAtoms.push({
        artifactId,
        atomId: atom.id,
        proofType: atom.proofType ?? atom.claimType ?? null,
        packagingFunction: atom.packagingFunction ?? atom.function ?? null,
        visualProofType: atom.visualProofType ?? atom.proofType ?? atom.claimType ?? null,
        visualHierarchy: atom.visualHierarchy ?? null,
        risk: atom.risk ?? null,
        visualElementsJson: json(atom.visualElements ?? []),
        replaceableFormsJson: json(atom.replaceableForms ?? atom.replaceableVariables ?? []),
      });
    }
    pushSourceRefs(rows.atomSourceRefs, {
      artifactId,
      ownerIdKey: "atomId",
      ownerId: atom.id,
      sourceRefs: atom.sourceRefs,
    });
  }
}

function projectedAtomRawJson(atom, atomType, slotRef) {
  const common = {
    id: atom.id,
    slotId: slotRef.slotId,
    slotType: slotRef.slotType,
    label: atom.label ?? null,
    function: atom.function ?? null,
    sourceRefs: atom.sourceRefs ?? null,
    confidence: atom.confidence ?? null,
    needReview: Boolean(atom.needReview),
  };
  if (atomType === "script") {
    return {
      ...common,
      claimType: atom.claimType ?? null,
      proofNeed: atom.proofNeed ?? null,
      mustKeep: atom.mustKeep ?? [],
      replaceableVariables: atom.replaceableVariables ?? [],
    };
  }
  if (atomType === "rhythm") {
    return {
      ...common,
      pace: atom.pace ?? null,
      densityType: atom.densityType ?? null,
      beatShape: atom.beatShape ?? null,
      avoidFor: atom.avoidFor ?? [],
      syncPoints: atom.syncPoints ?? [],
    };
  }
  return {
    ...common,
    packagingFunction: atom.packagingFunction ?? atom.function ?? null,
    proofType: atom.proofType ?? atom.claimType ?? null,
    visualProofType: atom.visualProofType ?? atom.proofType ?? atom.claimType ?? null,
    visualHierarchy: atom.visualHierarchy ?? null,
    visualElements: atom.visualElements ?? [],
    replaceableForms: atom.replaceableForms ?? atom.replaceableVariables ?? [],
    risk: atom.risk ?? null,
  };
}

function pushBindings(rows, analysis, artifactId) {
  for (const binding of analysis.bindingGraph?.bindings ?? []) {
    rows.bindings.push({
      artifactId,
      bindingId: binding.id,
      bindingType: binding.type ?? null,
      rule: binding.rule ?? null,
      globalRiskIfBroken: binding.riskIfBroken ?? null,
      confidence: binding.confidence ?? null,
    });
    for (const slotId of binding.slotIds ?? []) {
      rows.bindingRefs.push({ artifactId, bindingId: binding.id, refKind: "slot", refId: slotId });
    }
    for (const atomId of binding.atomIds ?? []) {
      rows.bindingRefs.push({ artifactId, bindingId: binding.id, refKind: "atom", refId: atomId });
    }
  }
}

function pushRules(rows, analysis, artifactId) {
  for (const rule of analysis.conflictChecks ?? []) {
    rows.rules.push({
      artifactId,
      ruleId: rule.id,
      ruleType: "conflict",
      reasonOrRule: rule.reason ?? null,
      fix: rule.fix ?? null,
      appliesToJson: json(rule.slotIds ?? rule.appliesTo ?? []),
      sourceBindingIdsJson: json(rule.sourceBindingIds ?? []),
    });
  }
  for (const rule of analysis.recombinationRules ?? []) {
    rows.rules.push({
      artifactId,
      ruleId: rule.id,
      ruleType: "recombination",
      reasonOrRule: rule.reason ?? null,
      fix: rule.fix ?? null,
      appliesToJson: json(rule.appliesTo ?? []),
      sourceBindingIdsJson: json(rule.sourceBindingIds ?? []),
    });
  }
}

function pushTemplates(rows, analysis, artifactId) {
  for (const template of analysis.recompositionTemplates ?? []) {
    rows.templates.push({
      artifactId,
      templateId: template.templateId,
      templateName: template.templateName ?? null,
      sequenceJson: json(template.sequence ?? []),
    });
  }
}

function pushSourceRefs(target, { artifactId, ownerIdKey, ownerId, sourceRefs }) {
  if (!ownerId || !sourceRefs) return;
  const refs = [
    ["shot", sourceRefs.shotRefs],
    ["script_segment_label", sourceRefs.scriptSegmentLabels],
    ["rhythm_section_label", sourceRefs.rhythmSectionLabels],
    ["packaging_block_label", sourceRefs.packagingBlockLabels],
  ];
  for (const [refType, values] of refs) {
    for (const refValue of values ?? []) {
      target.push({ artifactId, [ownerIdKey]: ownerId, refType, refValue });
    }
  }
}

function boolToInt(value) {
  return value ? 1 : 0;
}

function json(value) {
  return JSON.stringify(value ?? null);
}

module.exports = {
  buildFunctionSlotProjectionRows,
};
