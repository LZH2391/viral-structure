const {
  MAX_SHOT_NOTES,
  MAX_PACKAGING_BLOCKS,
  MAX_STACK_ITEMS,
  normalizeText,
  normalizeStringArray,
  normalizeFieldArray,
  normalizeConfidence,
} = require("./shared");

function validatePackagingStructure(parsed, input) {
  const overview = normalizeOverview(parsed?.overview);
  if (!overview.ok) return overview;

  const shotMap = new Map((Array.isArray(input?.shots) ? input.shots : []).map((shot, index) => [shot.shotId, { ...shot, order: index }]));
  const rawNotes = Array.isArray(parsed?.shotPackagingNotes) ? parsed.shotPackagingNotes : null;
  if (!rawNotes) {
    return invalidValidation("packaging_structure_missing_shot_notes", "包装结构 Agent 未返回 shotPackagingNotes", {
      validatorCode: "packaging_structure_missing_shot_notes",
      shotPackagingNoteCount: 0,
    });
  }
  if (rawNotes.length !== shotMap.size) {
    const noteShotRefs = rawNotes.map((note) => normalizeText(note?.shotRef, 80)).filter(Boolean);
    const inputShotRefs = Array.from(shotMap.keys());
    const missingShotRefs = inputShotRefs.filter((shotRef) => !noteShotRefs.includes(shotRef));
    const unexpectedShotRefs = noteShotRefs.filter((shotRef) => !shotMap.has(shotRef));
    return invalidValidation("packaging_structure_shot_notes_incomplete", "shotPackagingNotes 必须逐镜头覆盖所有输入 shots", {
      validatorCode: "packaging_structure_shot_notes_incomplete",
      expectedShotCount: shotMap.size,
      shotPackagingNoteCount: rawNotes.length,
      path: "shotPackagingNotes[].shotRef",
      field: "shotRef",
      missingShotRefs,
      unexpectedShotRefs,
      readableMessage: buildCoverageMessage({ scope: "shotPackagingNotes", missingShotRefs, unexpectedShotRefs }),
    });
  }
  if (rawNotes.length > MAX_SHOT_NOTES) {
    return invalidValidation("packaging_structure_too_many_shot_notes", "逐镜头包装备注数量超出允许范围", {
      validatorCode: "packaging_structure_too_many_shot_notes",
      shotPackagingNoteCount: rawNotes.length,
      maxShotNotes: MAX_SHOT_NOTES,
    });
  }

  const shotPackagingNotes = [];
  const seenShotRefs = new Set();
  for (let index = 0; index < rawNotes.length; index += 1) {
    const note = normalizeShotPackagingNote(rawNotes[index], index, shotMap);
    if (!note.ok) return note;
    if (seenShotRefs.has(note.note.shotRef)) {
      return invalidValidation("packaging_structure_duplicate_shot_note", "同一 shotRef 只能出现一条 shotPackagingNotes", {
        validatorCode: "packaging_structure_duplicate_shot_note",
        failingIndex: index,
        path: `shotPackagingNotes[${index}].shotRef`,
        field: "shotRef",
        shotRef: note.note.shotRef,
        readableMessage: `shotPackagingNotes[${index}].shotRef 重复: ${note.note.shotRef}`,
      });
    }
    seenShotRefs.add(note.note.shotRef);
    if (note.note.shotOrder !== index) {
      return invalidValidation("packaging_structure_shot_note_order_invalid", "shotPackagingNotes 必须按输入镜头顺序排列", {
        validatorCode: "packaging_structure_shot_note_order_invalid",
        failingIndex: index,
        path: `shotPackagingNotes[${index}].shotRef`,
        field: "shotRef",
        shotRef: note.note.shotRef,
        expectedShotRef: Array.from(shotMap.keys())[index] ?? null,
        readableMessage: `shotPackagingNotes[${index}].shotRef 顺序错误: 期望 ${Array.from(shotMap.keys())[index] ?? "无"}，实际 ${note.note.shotRef}`,
      });
    }
    const { shotOrder, ...cleanNote } = note.note;
    shotPackagingNotes.push(cleanNote);
  }

  const rawBlocks = Array.isArray(parsed?.packagingBlocks) ? parsed.packagingBlocks : null;
  if (!rawBlocks) {
    return invalidValidation("packaging_structure_missing_blocks", "包装结构 Agent 未返回 packagingBlocks", {
      validatorCode: "packaging_structure_missing_blocks",
      packagingBlockCount: 0,
    });
  }
  if (rawBlocks.length > MAX_PACKAGING_BLOCKS) {
    return invalidValidation("packaging_structure_too_many_blocks", "包装模式数量超出允许范围", {
      validatorCode: "packaging_structure_too_many_blocks",
      packagingBlockCount: rawBlocks.length,
      maxPackagingBlocks: MAX_PACKAGING_BLOCKS,
    });
  }
  const packagingBlocks = [];
  for (let index = 0; index < rawBlocks.length; index += 1) {
    const block = normalizePackagingBlock(rawBlocks[index], index, shotMap);
    if (!block.ok) return block;
    packagingBlocks.push(block.block);
  }

  const claimStack = normalizeStackItems(parsed?.claimStack, "claim", shotMap);
  if (!claimStack.ok) return claimStack;
  const proofStack = normalizeStackItems(parsed?.proofStack, "proof", shotMap);
  if (!proofStack.ok) return proofStack;
  const conversionWrap = normalizeConversionWrap(parsed?.conversionWrap, shotMap);
  if (!conversionWrap.ok) return conversionWrap;

  return {
    ok: true,
    overview: overview.overview,
    shotPackagingNotes,
    packagingBlocks,
    claimStack: claimStack.items,
    proofStack: proofStack.items,
    conversionWrap: conversionWrap.conversionWrap,
    summary: {
      validatorCode: null,
      shotPackagingNoteCount: shotPackagingNotes.length,
      packagingBlockCount: packagingBlocks.length,
      claimStackCount: claimStack.items.length,
      proofStackCount: proofStack.items.length,
    },
  };
}

function normalizeOverview(overview) {
  const summary = normalizeText(overview?.summary, 320);
  if (!summary) {
    return invalidValidation("packaging_structure_overview_required_field_missing", "overview 缺少必要字段", {
      validatorCode: "packaging_structure_overview_required_field_missing",
      path: "overview.summary",
      field: "summary",
      missingFields: ["summary"],
      readableMessage: "overview.summary 缺少或为空",
    });
  }
  return {
    ok: true,
    overview: {
      summary,
      fields: normalizeFieldArray(overview?.fields),
      uncertainties: normalizeStringArray(overview?.uncertainties, 5),
    },
  };
}

function normalizeShotPackagingNote(note, index, shotMap) {
  const shotRef = normalizeText(note?.shotRef, 80);
  const fields = normalizeFieldArray(note?.fields);
  const packagingFunction = normalizeText(note?.packagingFunction, 240);
  const missingFields = [];
  if (!shotRef) missingFields.push("shotRef");
  if (!fields.length) missingFields.push("fields");
  if (!packagingFunction) missingFields.push("packagingFunction");
  if (!shotRef || !fields.length || !packagingFunction) {
    return invalidValidation("packaging_structure_shot_note_required_field_missing", "shotPackagingNotes 缺少必要字段", {
      validatorCode: "packaging_structure_shot_note_required_field_missing",
      failingIndex: index,
      path: `shotPackagingNotes[${index}]`,
      missingFields,
      readableMessage: `shotPackagingNotes[${index}] 缺少必要字段: ${missingFields.join(", ")}`,
    });
  }
  const shot = shotMap.get(shotRef);
  if (!shot) {
    return invalidValidation("packaging_structure_unknown_shot_ref", "shotPackagingNotes.shotRef 引用了不存在的 shotId", {
      validatorCode: "packaging_structure_unknown_shot_ref",
      failingIndex: index,
      path: `shotPackagingNotes[${index}].shotRef`,
      field: "shotRef",
      shotRef,
      readableMessage: `shotPackagingNotes[${index}].shotRef 引用了不存在的 shotId: ${shotRef}`,
    });
  }
  return {
    ok: true,
    note: {
      noteId: normalizeText(note?.noteId, 80) || `packaging_note_${index + 1}`,
      shotRef,
      shotNo: shot.shotNo ?? null,
      fields,
      packagingFunction,
      confidence: normalizeConfidence(note?.confidence, 0.7),
      needReview: Boolean(note?.needReview),
      start: shot.start,
      end: shot.end,
      shotOrder: shot.order,
    },
  };
}

function normalizePackagingBlock(block, index, shotMap) {
  const label = normalizeText(block?.label, 120);
  const shotRefs = normalizeShotRefs(block?.shotRefs, shotMap, index, "block");
  if (!shotRefs.ok) return shotRefs;
  const fields = normalizeFieldArray(block?.fields);
  const packagingFunction = normalizeText(block?.packagingFunction, 240);
  const missingFields = [];
  if (!label) missingFields.push("label");
  if (!fields.length) missingFields.push("fields");
  if (!packagingFunction) missingFields.push("packagingFunction");
  if (!label || !fields.length || !packagingFunction) {
    return invalidValidation("packaging_structure_block_required_field_missing", "packagingBlocks 缺少必要字段", {
      validatorCode: "packaging_structure_block_required_field_missing",
      failingIndex: index,
      path: `packagingBlocks[${index}]`,
      missingFields,
      readableMessage: `packagingBlocks[${index}] 缺少必要字段: ${missingFields.join(", ")}`,
    });
  }
  const range = shotRange(shotRefs.shotRefs, shotMap);
  return {
    ok: true,
    block: {
      blockId: normalizeText(block?.blockId, 80) || `packaging_block_${index + 1}`,
      label,
      shotRefs: shotRefs.shotRefs,
      fields,
      packagingFunction,
      confidence: normalizeConfidence(block?.confidence, 0.7),
      needReview: Boolean(block?.needReview),
      start: range.start,
      end: range.end,
    },
  };
}

function normalizeStackItems(value, kind, shotMap) {
  const rawItems = Array.isArray(value) ? value : null;
  if (!rawItems) {
    return invalidValidation(`packaging_structure_missing_${kind}_stack`, `包装结构 Agent 未返回 ${kind}Stack`, {
      validatorCode: `packaging_structure_missing_${kind}_stack`,
    });
  }
  if (rawItems.length > MAX_STACK_ITEMS) {
    return invalidValidation(`packaging_structure_too_many_${kind}_stack_items`, `${kind}Stack 数量超出允许范围`, {
      validatorCode: `packaging_structure_too_many_${kind}_stack_items`,
      count: rawItems.length,
      maxStackItems: MAX_STACK_ITEMS,
    });
  }
  const items = [];
  for (let index = 0; index < rawItems.length; index += 1) {
    const label = normalizeText(rawItems[index]?.label, 120);
    const fields = normalizeFieldArray(rawItems[index]?.fields);
    const shotRefs = normalizeShotRefs(rawItems[index]?.shotRefs, shotMap, index, kind);
    if (!shotRefs.ok) return shotRefs;
    const missingFields = [];
    if (!label) missingFields.push("label");
    if (!fields.length) missingFields.push("fields");
    if (!label || !fields.length) {
      return invalidValidation(`packaging_structure_${kind}_stack_required_field_missing`, `${kind}Stack 缺少必要字段`, {
        validatorCode: `packaging_structure_${kind}_stack_required_field_missing`,
        failingIndex: index,
        path: `${kind}Stack[${index}]`,
        missingFields,
        readableMessage: `${kind}Stack[${index}] 缺少必要字段: ${missingFields.join(", ")}`,
      });
    }
    const range = shotRange(shotRefs.shotRefs, shotMap);
    items.push({
      [`${kind}Id`]: normalizeText(rawItems[index]?.[`${kind}Id`], 80) || `${kind}_stack_${index + 1}`,
      label,
      shotRefs: shotRefs.shotRefs,
      fields,
      start: range.start,
      end: range.end,
    });
  }
  return { ok: true, items };
}

function normalizeConversionWrap(value, shotMap) {
  const summary = normalizeText(value?.summary, 320);
  const fields = normalizeFieldArray(value?.fields);
  const shotRefs = normalizeShotRefs(value?.shotRefs, shotMap, 0, "conversion");
  if (!shotRefs.ok) return shotRefs;
  if (!summary) {
    return invalidValidation("packaging_structure_conversion_wrap_required_field_missing", "conversionWrap 缺少必要字段", {
      validatorCode: "packaging_structure_conversion_wrap_required_field_missing",
      path: "conversionWrap.summary",
      field: "summary",
      missingFields: ["summary"],
      readableMessage: "conversionWrap.summary 缺少或为空",
    });
  }
  const range = shotRange(shotRefs.shotRefs, shotMap);
  return {
    ok: true,
    conversionWrap: {
      summary,
      fields,
      shotRefs: shotRefs.shotRefs,
      uncertainties: normalizeStringArray(value?.uncertainties, 5),
      start: range.start,
      end: range.end,
    },
  };
}

function normalizeShotRefs(value, shotMap, failingIndex, scope) {
  const shotRefs = Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
  if (!shotRefs.length) {
    return invalidValidation("packaging_structure_missing_shot_refs", `${scope}.shotRefs 不能为空`, {
      validatorCode: "packaging_structure_missing_shot_refs",
      failingIndex,
      scope,
      path: `${scopePath(scope, failingIndex)}.shotRefs`,
      field: "shotRefs",
      readableMessage: `${scopePath(scope, failingIndex)}.shotRefs 不能为空`,
    });
  }
  const uniqueRefs = Array.from(new Set(shotRefs));
  if (uniqueRefs.length !== shotRefs.length) {
    const duplicateShotRefs = shotRefs.filter((shotRef, refIndex) => shotRefs.indexOf(shotRef) !== refIndex);
    return invalidValidation("packaging_structure_duplicate_shot_refs", `${scope}.shotRefs 不允许重复引用同一镜头`, {
      validatorCode: "packaging_structure_duplicate_shot_refs",
      failingIndex,
      scope,
      path: `${scopePath(scope, failingIndex)}.shotRefs`,
      field: "shotRefs",
      duplicateShotRefs: Array.from(new Set(duplicateShotRefs)),
      readableMessage: `${scopePath(scope, failingIndex)}.shotRefs 重复引用: ${Array.from(new Set(duplicateShotRefs)).join(", ")}`,
    });
  }
  for (let refIndex = 0; refIndex < uniqueRefs.length; refIndex += 1) {
    const shotRef = uniqueRefs[refIndex];
    if (!shotMap.has(shotRef)) {
      return invalidValidation("packaging_structure_unknown_shot_ref", `${scope}.shotRefs 引用了不存在的 shotId`, {
        validatorCode: "packaging_structure_unknown_shot_ref",
        failingIndex,
        scope,
        refIndex,
        path: `${scopePath(scope, failingIndex)}.shotRefs[${refIndex}]`,
        field: "shotRefs",
        shotRef,
        readableMessage: `${scopePath(scope, failingIndex)}.shotRefs[${refIndex}] 引用了不存在的 shotId: ${shotRef}`,
      });
    }
  }
  return { ok: true, shotRefs: uniqueRefs };
}

function shotRange(shotRefs, shotMap) {
  const shots = shotRefs.map((shotRef) => shotMap.get(shotRef)).filter(Boolean).sort((a, b) => a.order - b.order);
  return {
    start: shots[0]?.start ?? null,
    end: shots[shots.length - 1]?.end ?? null,
  };
}

function invalidValidation(code, message, summary) {
  return {
    ok: false,
    code,
    message,
    summary: {
      message,
      readableMessage: summary?.readableMessage ?? message,
      ...summary,
    },
  };
}

function scopePath(scope, failingIndex) {
  if (scope === "block") return `packagingBlocks[${failingIndex}]`;
  if (scope === "claim") return `claimStack[${failingIndex}]`;
  if (scope === "proof") return `proofStack[${failingIndex}]`;
  if (scope === "conversion") return "conversionWrap";
  return `${scope}[${failingIndex}]`;
}

function buildCoverageMessage({ scope, missingShotRefs, unexpectedShotRefs }) {
  const parts = [`${scope}[].shotRef 未逐镜头覆盖输入 shots`];
  if (missingShotRefs.length) parts.push(`缺失: ${missingShotRefs.join(", ")}`);
  if (unexpectedShotRefs.length) parts.push(`多余: ${unexpectedShotRefs.join(", ")}`);
  return parts.join("；");
}

module.exports = {
  validatePackagingStructure,
};
