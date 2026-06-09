const fs = require("fs/promises");
const path = require("path");

const SCHEMA_VERSION = "function_slot_restructure_display.v1";
const STAGE_NAME = "function.slot.restructure_display.transform";

const TARGET_SECTIONS = [
  { key: "goalAndAssumptions", number: "1", title: "1. 重组目标与假设", heading: "重组目标与假设" },
  { key: "finalSlotChain", number: "2", title: "2. 最终功能槽位链", heading: "最终功能槽位链" },
  { key: "atomLandingTable", number: "3", title: "3. Atoms 落地表", heading: "Atoms 落地表" },
  { key: "scriptSegments", number: "5", title: "5. 脚本段落方案", heading: "脚本段落方案" },
  { key: "rhythmCurve", number: "6", title: "6. 节奏曲线", heading: "节奏曲线" },
  { key: "packagingProof", number: "7", title: "7. 包装与证明方案", heading: "包装与证明方案" },
];

async function transformRestructureFinalFile({
  inputPath,
  outputPath,
  restructureArtifactId = null,
  convertedAt = () => new Date().toISOString(),
} = {}) {
  if (!inputPath) throw validationError("input_path_required", "inputPath is required", []);
  const markdown = await fs.readFile(inputPath, "utf8");
  const result = transformRestructureFinalMarkdown(markdown, {
    restructureFinalPath: normalizePath(inputPath),
    restructureArtifactId,
    convertedAt,
  });
  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  return result;
}

function transformRestructureFinalMarkdown(markdown, {
  restructureFinalPath = null,
  restructureArtifactId = null,
  convertedAt = () => new Date().toISOString(),
} = {}) {
  const text = stripBom(String(markdown ?? ""));
  const lines = splitLines(text);
  const sectionRanges = findTargetSectionRanges(lines);
  const sections = {};
  const missingSections = [];
  const errors = [];

  for (const definition of TARGET_SECTIONS) {
    const range = sectionRanges.get(definition.key);
    if (!range) {
      missingSections.push(definition.key);
      sections[definition.key] = { title: definition.title, items: [] };
      continue;
    }
    try {
      sections[definition.key] = {
        title: definition.title,
        items: parseSectionItems(lines.slice(range.start + 1, range.end), {
          sectionKey: definition.key,
          sectionTitle: definition.title,
          lineOffset: range.start + 2,
        }),
      };
    } catch (error) {
      errors.push(...normalizeErrors(error));
      sections[definition.key] = { title: definition.title, items: [] };
    }
  }

  if (errors.length) {
    throw validationError("restructure_display_markdown_parse_failed", "restructure.final.md 展示转换解析失败", errors);
  }
  if (missingSections.length === TARGET_SECTIONS.length) {
    throw validationError("restructure_display_no_target_sections", "restructure.final.md 未识别到目标展示章节", [
      errorAt("sections", null, "未识别到第 1、2、3、5、6、7 节，请检查 Markdown 标题格式", {
        sectionKey: null,
        sectionTitle: null,
        blockType: "heading",
        snippet: lines.slice(0, 80).join("\n"),
      }),
    ]);
  }

  const result = {
    schemaVersion: SCHEMA_VERSION,
    source: {
      restructureFinalPath: normalizePath(restructureFinalPath),
      restructureArtifactId: restructureArtifactId ?? null,
    },
    sections,
    missingSections,
    sourceTextDigest: {
      sectionCount: TARGET_SECTIONS.length - missingSections.length,
      convertedAt: convertedAt(),
    },
  };
  validateRestructureDisplaySectionJson(result);
  return result;
}

function validateRestructureDisplaySectionJson(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(errorAt("root", null, "root must be JSON object"));
  }
  if (value?.schemaVersion !== SCHEMA_VERSION) {
    errors.push(errorAt("schemaVersion", null, `schemaVersion must be ${SCHEMA_VERSION}`));
  }
  if (!value?.source || typeof value.source !== "object" || Array.isArray(value.source)) {
    errors.push(errorAt("source", null, "source must be object"));
  }
  const allowedKeys = new Set(TARGET_SECTIONS.map((section) => section.key));
  const sections = value?.sections;
  if (!sections || typeof sections !== "object" || Array.isArray(sections)) {
    errors.push(errorAt("sections", null, "sections must be object"));
  } else {
    for (const key of Object.keys(sections)) {
      if (!allowedKeys.has(key)) errors.push(errorAt(`sections.${key}`, null, "unexpected section key"));
    }
    for (const definition of TARGET_SECTIONS) {
      const section = sections[definition.key];
      const sectionPath = `sections.${definition.key}`;
      if (!section || typeof section !== "object" || Array.isArray(section)) {
        errors.push(errorAt(sectionPath, null, "section must be object"));
        continue;
      }
      if (typeof section.title !== "string" || !section.title.trim()) {
        errors.push(errorAt(`${sectionPath}.title`, null, "section.title must be non-empty string"));
      }
      if (!Array.isArray(section.items)) {
        errors.push(errorAt(`${sectionPath}.items`, null, "section.items must be array"));
        continue;
      }
      section.items.forEach((item, index) => validateItem(item, `${sectionPath}.items[${index}]`, errors));
    }
  }
  if (!Array.isArray(value?.missingSections)) {
    errors.push(errorAt("missingSections", null, "missingSections must be array"));
  } else {
    for (const key of value.missingSections) {
      if (!allowedKeys.has(key)) errors.push(errorAt("missingSections", null, `unknown missing section ${key}`));
    }
  }
  if (!value?.sourceTextDigest || typeof value.sourceTextDigest !== "object" || Array.isArray(value.sourceTextDigest)) {
    errors.push(errorAt("sourceTextDigest", null, "sourceTextDigest must be object"));
  }
  if (errors.length) {
    throw validationError("restructure_display_schema_invalid", "展示转换 JSON 校验失败", errors);
  }
  return true;
}

function buildAgentRepairRequest({ error, inputPath, repairedPath = null, outputPath = null, restructureArtifactId = null, repairAttemptCount = 1 } = {}) {
  const validationErrors = normalizeErrors(error);
  return {
    role: "function-slot-restructure-display-transformer",
    turnTemplate: "repairTurn",
    repairAttemptCount,
    allowedRepairScope: "format_only",
    constraints: [
      "只修复 Markdown 格式或 JSON 结构问题",
      "不得改写、增删、补充原文语义内容",
      "修复后必须再次运行确定性脚本转换",
    ],
    source: {
      restructureFinalPath: normalizePath(inputPath),
      repairedPath: repairedPath ? normalizePath(repairedPath) : null,
      restructureArtifactId: restructureArtifactId ?? null,
      outputPath: outputPath ? normalizePath(outputPath) : null,
    },
    stageName: STAGE_NAME,
    errorCode: error?.code ?? "restructure_display_transform_failed",
    errorMessage: error?.message ?? "展示转换失败",
    validationErrors,
    repairTargets: validationErrors.map((item) => ({
      sectionKey: item.sectionKey ?? null,
      sectionTitle: item.sectionTitle ?? null,
      blockType: item.blockType ?? null,
      line: item.line ?? null,
      path: item.path ?? null,
      message: item.message,
      snippet: item.snippet ?? null,
    })),
  };
}

function parseSectionItems(sectionLines, context) {
  const items = [];
  let paragraph = [];
  let paragraphStartLine = null;
  let list = [];
  let listStartLine = null;
  let index = 0;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    items.push(withLocation({
      type: "paragraph",
      text: paragraph.join("\n").trim(),
    }, context, paragraphStartLine));
    paragraph = [];
    paragraphStartLine = null;
  };
  const flushList = () => {
    if (!list.length) return;
    items.push(withLocation({
      type: "list",
      items: list,
    }, context, listStartLine));
    list = [];
    listStartLine = null;
  };

  while (index < sectionLines.length) {
    const rawLine = sectionLines[index] ?? "";
    const lineNumber = context.lineOffset + index;
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      index += 1;
      continue;
    }

    if (isTableStart(sectionLines, index)) {
      flushParagraph();
      flushList();
      const { table, nextIndex } = parseTable(sectionLines, index, context);
      items.push(table);
      index = nextIndex;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      items.push(withLocation({ type: "heading", text: heading[2].trim() }, context, lineNumber));
      index += 1;
      continue;
    }

    const listMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      if (!list.length) listStartLine = lineNumber;
      list.push(listMatch[1].trim());
      index += 1;
      continue;
    }

    flushList();
    if (!paragraph.length) paragraphStartLine = lineNumber;
    paragraph.push(trimmed);
    index += 1;
  }

  flushParagraph();
  flushList();
  return items;
}

function parseTable(lines, startIndex, context) {
  const startLine = context.lineOffset + startIndex;
  const tableLines = [];
  let index = startIndex;
  while (index < lines.length && lines[index].trim().startsWith("|")) {
    tableLines.push(lines[index]);
    index += 1;
  }
  try {
    const rawColumns = splitTableRow(tableLines[0]).map(cleanCell);
    const columns = normalizeTableColumns(rawColumns, context);
    const separator = splitTableRow(tableLines[1]);
    if (!columns.length || separator.length !== columns.length || !separator.every(isSeparatorCell)) {
      throw new Error("invalid markdown table separator");
    }
    const rows = [];
    for (let rowIndex = 2; rowIndex < tableLines.length; rowIndex += 1) {
      const cells = splitTableRow(tableLines[rowIndex]).map(cleanCell);
      if (cells.length !== columns.length) {
        return {
          table: withLocation({
            type: "rawMarkdown",
            text: tableLines.join("\n"),
            parseError: `table row has ${cells.length} cells, expected ${columns.length}`,
          }, context, startLine, "table"),
          nextIndex: index,
        };
      }
      rows.push(Object.fromEntries(columns.map((column, columnIndex) => [column, cells[columnIndex] ?? ""])));
    }
    return {
      table: withLocation({ type: "table", columns, rows }, context, startLine, "table"),
      nextIndex: index,
    };
  } catch (error) {
    return {
      table: withLocation({
        type: "rawMarkdown",
        text: tableLines.join("\n"),
        parseError: error.message,
      }, context, startLine, "table"),
      nextIndex: index,
    };
  }
}

function findTargetSectionRanges(lines) {
  const headings = [];
  lines.forEach((line, index) => {
    const match = line.trim().match(/^#{1,6}\s+(\d+)[.．、]\s*(.+)$/);
    if (match) headings.push({ index, number: match[1], heading: normalizeHeadingText(match[2]) });
  });
  const ranges = new Map();
  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index];
    const definition = TARGET_SECTIONS.find((item) => item.number === current.number && isTargetHeading(current.heading, item.heading));
    if (!definition) continue;
    ranges.set(definition.key, {
      start: current.index,
      end: headings[index + 1]?.index ?? lines.length,
    });
  }
  return ranges;
}

function isTargetHeading(actual, expected) {
  const normalizedActual = normalizeHeadingText(actual);
  const normalizedExpected = normalizeHeadingText(expected);
  return normalizedActual === normalizedExpected || normalizedActual.startsWith(normalizedExpected);
}

function normalizeHeadingText(value) {
  return String(value ?? "")
    .replace(/[#`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isTableStart(lines, index) {
  return Boolean(
    lines[index]?.trim().startsWith("|")
    && lines[index + 1]?.trim().startsWith("|")
    && splitTableRow(lines[index + 1]).every(isSeparatorCell),
  );
}

function splitTableRow(line) {
  let text = String(line ?? "").trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|")) text = text.slice(0, -1);
  const cells = [];
  let current = "";
  let escaped = false;
  for (const char of text) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function isSeparatorCell(value) {
  return /^:?-{3,}:?$/.test(String(value ?? "").trim());
}

function cleanCell(value) {
  return String(value ?? "").replace(/\\\|/g, "|").trim();
}

function normalizeTableColumns(columns, context) {
  if (context.sectionKey !== "atomLandingTable") return columns;
  let lastAtomKind = null;
  return columns.map((column) => {
    const atomKind = atomKindFromColumn(column);
    if (atomKind) {
      lastAtomKind = atomKind;
      return column;
    }
    if (!lastAtomKind || !isGenericAtomLandingColumn(column)) return column;
    return `${lastAtomKind} atom ${column}`;
  });
}

function atomKindFromColumn(column) {
  const normalized = normalizeColumnKey(column);
  if (normalized.includes("scriptatom") || normalized.includes("script原子") || normalized.includes("脚本原子")) return "script";
  if (normalized.includes("rhythmatom") || normalized.includes("rhythm原子") || normalized.includes("节奏原子")) return "rhythm";
  if (normalized.includes("packagingatom") || normalized.includes("packaging原子") || normalized.includes("包装原子")) return "packaging";
  return null;
}

function isGenericAtomLandingColumn(column) {
  const normalized = normalizeColumnKey(column);
  return !atomKindFromColumn(column)
    && normalized.includes("原标签")
    && (normalized.includes("本方案落地") || normalized.includes("落地"));
}

function normalizeColumnKey(value) {
  return String(value ?? "").toLowerCase().replace(/[()\[\]（）【】\s_：:·\-→>]/g, "");
}

function validateItem(item, itemPath, errors) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    errors.push(errorAt(itemPath, null, "item must be object"));
    return;
  }
  if (!["table", "list", "paragraph", "heading", "rawMarkdown"].includes(item.type)) {
    errors.push(errorAt(`${itemPath}.type`, item.line ?? null, "item.type is invalid"));
  }
  if (item.type === "table") {
    if (!Array.isArray(item.columns)) errors.push(errorAt(`${itemPath}.columns`, item.line ?? null, "table.columns must be array"));
    if (!Array.isArray(item.rows)) errors.push(errorAt(`${itemPath}.rows`, item.line ?? null, "table.rows must be array"));
  }
  if (item.type === "list" && !Array.isArray(item.items)) {
    errors.push(errorAt(`${itemPath}.items`, item.line ?? null, "list.items must be array"));
  }
  if (["paragraph", "heading", "rawMarkdown"].includes(item.type) && typeof item.text !== "string") {
    errors.push(errorAt(`${itemPath}.text`, item.line ?? null, `${item.type}.text must be string`));
  }
}

function withLocation(item, context, line, blockType = item.type) {
  return {
    ...item,
    sourceLocation: {
      sectionKey: context.sectionKey,
      sectionTitle: context.sectionTitle,
      line,
      blockType,
    },
  };
}

function validationError(code, message, validationErrors) {
  const error = new Error(message);
  error.code = code;
  error.validationErrors = validationErrors;
  return error;
}

function errorAt(pathValue, line, message, extra = {}) {
  return { path: pathValue, line, message, ...extra };
}

function normalizeErrors(error) {
  if (Array.isArray(error?.validationErrors)) return error.validationErrors;
  if (Array.isArray(error)) return error;
  return [errorAt(null, null, error?.message ?? "unknown error")];
}

function splitLines(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function normalizePath(filePath) {
  if (!filePath) return null;
  return String(filePath).replaceAll("\\", "/");
}

module.exports = {
  SCHEMA_VERSION,
  STAGE_NAME,
  TARGET_SECTIONS,
  buildAgentRepairRequest,
  transformRestructureFinalFile,
  transformRestructureFinalMarkdown,
  validateRestructureDisplaySectionJson,
};
