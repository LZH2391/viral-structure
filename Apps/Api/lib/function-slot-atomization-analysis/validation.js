const {
  MAX_ATOMS,
  MAX_RULES,
  MAX_SLOTS,
  normalizeConfidence,
  normalizeStringArray,
  normalizeText,
} = require("./shared");

const BINDING_TYPES = new Set(["support", "require", "sync", "substitute", "conflict", "carryover"]);

function validateFunctionSlotAtomization(parsed) {
  const rawInventory = parsed?.atom_inventory ?? parsed?.atomInventory ?? null;
  const rawSlotMap = parsed?.slot_map ?? parsed?.slotMap ?? null;
  const rawBindingGraph = parsed?.binding_graph ?? parsed?.bindingGraph ?? null;
  const rawSlots = Array.isArray(rawSlotMap?.slots) ? rawSlotMap.slots : null;

  if (!rawInventory || typeof rawInventory !== "object") {
    return invalidValidation("function_slot_atomization_missing_inventory", "Agent 未返回 atom_inventory", { path: "atom_inventory" });
  }
  if (!rawSlots?.length) {
    return invalidValidation("function_slot_atomization_missing_slots", "Agent 未返回有效 slot_map.slots", { path: "slot_map.slots" });
  }
  if (rawSlots.length > MAX_SLOTS) {
    return invalidValidation("function_slot_atomization_too_many_slots", "功能槽位数量超出允许范围", { slotCount: rawSlots.length, maxSlots: MAX_SLOTS });
  }

  const scriptAtoms = normalizeAtoms(rawInventory.script_atoms ?? rawInventory.scriptAtoms, "script");
  const rhythmAtoms = normalizeAtoms(rawInventory.rhythm_atoms ?? rawInventory.rhythmAtoms, "rhythm");
  const packagingAtoms = normalizeAtoms(rawInventory.packaging_atoms ?? rawInventory.packagingAtoms, "packaging");
  if (!scriptAtoms.length || !rhythmAtoms.length || !packagingAtoms.length) {
    return invalidValidation("function_slot_atomization_atom_type_missing", "三类原子都不能为空", {
      scriptAtomCount: scriptAtoms.length,
      rhythmAtomCount: rhythmAtoms.length,
      packagingAtomCount: packagingAtoms.length,
    });
  }
  if (scriptAtoms.length + rhythmAtoms.length + packagingAtoms.length > MAX_ATOMS) {
    return invalidValidation("function_slot_atomization_too_many_atoms", "原子数量超出允许范围", {
      atomCount: scriptAtoms.length + rhythmAtoms.length + packagingAtoms.length,
      maxAtoms: MAX_ATOMS,
    });
  }

  const scriptAtomIds = new Set(scriptAtoms.map((atom) => atom.id));
  const rhythmAtomIds = new Set(rhythmAtoms.map((atom) => atom.id));
  const packagingAtomIds = new Set(packagingAtoms.map((atom) => atom.id));
  const allAtomIds = new Set([...scriptAtomIds, ...rhythmAtomIds, ...packagingAtomIds]);
  const slots = [];
  for (let index = 0; index < rawSlots.length; index += 1) {
    const slot = normalizeSlot(rawSlots[index], index);
    if (!slot.slotId || !slot.slotName || !slot.slotType || !slot.persuasionTask) {
      return invalidValidation("function_slot_atomization_slot_field_missing", "功能槽位缺少必要字段", {
        path: `slot_map.slots[${index}]`,
        slotId: slot.slotId,
      });
    }
    if (!slot.scriptAtomIds.some((id) => scriptAtomIds.has(id))) {
      return invalidValidation("function_slot_atomization_slot_missing_script_atom", "功能槽位缺少有效脚本原子绑定", { path: `slot_map.slots[${index}].script_atom_ids`, slotId: slot.slotId });
    }
    if (!slot.rhythmAtomIds.some((id) => rhythmAtomIds.has(id))) {
      return invalidValidation("function_slot_atomization_slot_missing_rhythm_atom", "功能槽位缺少有效节奏原子绑定", { path: `slot_map.slots[${index}].rhythm_atom_ids`, slotId: slot.slotId });
    }
    if (!slot.packagingAtomIds.some((id) => packagingAtomIds.has(id))) {
      return invalidValidation("function_slot_atomization_slot_missing_packaging_atom", "功能槽位缺少有效包装原子绑定", { path: `slot_map.slots[${index}].packaging_atom_ids`, slotId: slot.slotId });
    }
    slots.push(slot);
  }

  const slotIds = new Set(slots.map((slot) => slot.slotId));
  const bindings = normalizeBindings(rawBindingGraph?.bindings, slotIds, allAtomIds);
  const conflictChecks = normalizeRuleList(parsed?.conflict_checks ?? parsed?.conflictChecks, "conflict");
  const recombinationRules = normalizeRuleList(parsed?.recombination_rules ?? parsed?.recombinationRules, "rule");
  const recompositionTemplates = normalizeTemplates(parsed?.recomposition_templates ?? parsed?.recompositionTemplates);

  return {
    ok: true,
    analysis: {
      atomInventory: {
        scriptAtoms,
        rhythmAtoms,
        packagingAtoms,
      },
      slotMap: { slots },
      bindingGraph: { bindings },
      conflictChecks,
      recombinationRules,
      recompositionTemplates,
    },
    summary: {
      validatorCode: null,
      slotCount: slots.length,
      scriptAtomCount: scriptAtoms.length,
      rhythmAtomCount: rhythmAtoms.length,
      packagingAtomCount: packagingAtoms.length,
      bindingCount: bindings.length,
      recombinationRuleCount: recombinationRules.length,
      templateCount: recompositionTemplates.length,
    },
  };
}

function normalizeAtoms(value, atomType) {
  if (!Array.isArray(value)) return [];
  return value.map((atom, index) => ({
    id: normalizeText(atom?.id, 64) || defaultAtomId(atomType, index),
    slot: normalizeText(atom?.slot, 120),
    label: normalizeText(atom?.label),
    function: normalizeText(atom?.semantic_function ?? atom?.attention_function ?? atom?.packaging_function ?? atom?.function, 320),
    claimType: normalizeText(atom?.claim_type ?? atom?.proof_type ?? "", 120),
    proofNeed: normalizeText(atom?.proof_need ?? "", 260),
    pace: normalizeText(atom?.pace ?? "", 120),
    densityType: normalizeText(atom?.density_type ?? "", 120),
    beatShape: normalizeText(atom?.beat_shape ?? "", 160),
    visualHierarchy: normalizeText(atom?.visual_hierarchy ?? "", 220),
    visualElements: normalizeStringArray(atom?.visual_elements ?? atom?.visualElements, 16),
    risk: normalizeText(atom?.risk ?? "", 260),
    mustKeep: normalizeStringArray(atom?.must_keep, 12),
    replaceableVariables: normalizeStringArray(atom?.replaceable_variables ?? atom?.replaceable_style, 16),
    syncPoints: normalizeStringArray(atom?.sync_points, 16),
    avoidFor: normalizeStringArray(atom?.avoid_for, 12),
    sourceRefs: normalizeSourceRefs(atom?.source_refs ?? atom?.sourceRefs),
    confidence: normalizeConfidence(atom?.confidence, 0.72),
    needReview: Boolean(atom?.need_review ?? atom?.needReview),
  })).filter((atom) => atom.id && atom.label && atom.function);
}

function normalizeSlot(slot, index) {
  return {
    slotId: normalizeText(slot?.slot_id ?? slot?.slotId, 64) || `F${String(index + 1).padStart(3, "0")}`,
    slotOrder: Number.isFinite(Number(slot?.slot_order ?? slot?.slotOrder)) ? Number(slot?.slot_order ?? slot?.slotOrder) : index + 1,
    slotName: normalizeText(slot?.slot_name ?? slot?.slotName),
    slotType: normalizeText(slot?.slot_type ?? slot?.slotType, 120),
    viewerStateBefore: normalizeText(slot?.viewer_state_before ?? slot?.viewerStateBefore, 260),
    viewerStateAfter: normalizeText(slot?.viewer_state_after ?? slot?.viewerStateAfter, 260),
    persuasionTask: normalizeText(slot?.persuasion_task ?? slot?.persuasionTask, 360),
    scriptAtomIds: normalizeStringArray(slot?.script_atom_ids ?? slot?.scriptAtomIds, 12),
    rhythmAtomIds: normalizeStringArray(slot?.rhythm_atom_ids ?? slot?.rhythmAtomIds, 12),
    packagingAtomIds: normalizeStringArray(slot?.packaging_atom_ids ?? slot?.packagingAtomIds, 12),
    requiredSyncPoints: normalizeStringArray(slot?.required_sync_points ?? slot?.requiredSyncPoints, 12),
    substitutionRules: normalizeStringArray(slot?.substitution_rules ?? slot?.substitutionRules, 12),
    sourceRefs: normalizeSourceRefs(slot?.source_refs ?? slot?.sourceRefs),
    confidence: normalizeConfidence(slot?.confidence, 0.72),
    needReview: Boolean(slot?.need_review ?? slot?.needReview),
  };
}

function normalizeBindings(value, slotIds, allAtomIds) {
  if (!Array.isArray(value)) return [];
  return value.map((binding, index) => {
    const type = normalizeText(binding?.type, 40);
    const slotRefs = normalizeStringArray(binding?.slot_ids ?? binding?.slotIds, 8).filter((id) => slotIds.has(id));
    const atomRefs = normalizeStringArray(binding?.atom_ids ?? binding?.atomIds, 16).filter((id) => allAtomIds.has(id));
    return {
      id: normalizeText(binding?.id, 64) || `B${String(index + 1).padStart(3, "0")}`,
      type: BINDING_TYPES.has(type) ? type : "support",
      slotIds: slotRefs,
      atomIds: atomRefs,
      rule: normalizeText(binding?.rule, 360),
      riskIfBroken: normalizeText(binding?.risk_if_broken ?? binding?.riskIfBroken, 260),
      confidence: normalizeConfidence(binding?.confidence, 0.72),
    };
  }).filter((binding) => binding.rule).slice(0, MAX_RULES);
}

function normalizeRuleList(value, fallbackPrefix) {
  if (!Array.isArray(value)) return [];
  return value.map((rule, index) => ({
    id: normalizeText(rule?.id, 64) || `${fallbackPrefix}_${index + 1}`,
    slotIds: normalizeStringArray(rule?.slot_ids ?? rule?.slotIds, 8),
    atomIds: normalizeStringArray(rule?.atom_ids ?? rule?.atomIds, 12),
    reason: normalizeText(rule?.reason ?? rule?.rule, 360),
    fix: normalizeText(rule?.fix, 260),
    appliesTo: normalizeStringArray(rule?.applies_to ?? rule?.appliesTo, 8),
    sourceBindingIds: normalizeStringArray(rule?.source_binding_ids ?? rule?.sourceBindingIds, 8),
  })).filter((rule) => rule.reason).slice(0, MAX_RULES);
}

function normalizeTemplates(value) {
  if (!Array.isArray(value)) return [];
  return value.map((template, index) => ({
    templateId: normalizeText(template?.template_id ?? template?.templateId, 64) || `T${String(index + 1).padStart(3, "0")}`,
    templateName: normalizeText(template?.template_name ?? template?.templateName),
    sequence: normalizeStringArray(template?.sequence, 16),
  })).filter((template) => template.templateName || template.sequence.length).slice(0, 12);
}

function normalizeSourceRefs(value) {
  if (!value || typeof value !== "object") return { shotRefs: [] };
  return {
    scriptSegmentLabels: normalizeStringArray(value.script_segment_labels ?? value.scriptSegmentLabels, 8),
    rhythmSectionLabels: normalizeStringArray(value.rhythm_section_labels ?? value.rhythmSectionLabels, 8),
    packagingBlockLabels: normalizeStringArray(value.packaging_block_labels ?? value.packagingBlockLabels, 8),
    shotRefs: normalizeStringArray(value.shot_refs ?? value.shotRefs, 24),
  };
}

function defaultAtomId(atomType, index) {
  const prefix = atomType === "script" ? "S" : atomType === "rhythm" ? "R" : "P";
  return `${prefix}${String(index + 1).padStart(3, "0")}`;
}

function invalidValidation(code, message, summary = {}) {
  return {
    ok: false,
    code,
    message,
    summary: {
      validatorCode: code,
      message,
      readableMessage: summary.readableMessage ?? message,
      ...summary,
    },
  };
}

module.exports = {
  validateFunctionSlotAtomization,
};
