const fs = require("fs/promises");
const path = require("path");
const { createHash } = require("crypto");

const WORKSPACE_ROOT = path.resolve(__dirname, "..", "..", "..");
const ROLE_CONFIG_PATH = path.join(WORKSPACE_ROOT, "Infrastructure", "ThreadPool", "thread_roles.json");

const profileCache = new Map();

async function loadRoleProfileByRole(role) {
  const config = JSON.parse(await fs.readFile(ROLE_CONFIG_PATH, "utf8"));
  const profilePath = config?.roles?.[role]?.profile_path;
  if (!profilePath) {
    throw new Error(`role profile_path missing: ${role}`);
  }
  return loadRoleProfile(profilePath, role);
}

async function loadRoleProfile(profilePath, expectedRole = null) {
  const resolvedProfilePath = path.isAbsolute(profilePath) ? profilePath : path.resolve(WORKSPACE_ROOT, profilePath);
  const cacheKey = `${expectedRole ?? ""}::${resolvedProfilePath}`;
  if (profileCache.has(cacheKey)) return profileCache.get(cacheKey);
  const raw = JSON.parse(await fs.readFile(resolvedProfilePath, "utf8"));
  if (expectedRole && raw.role !== expectedRole) {
    throw new Error(`role profile mismatch: expected ${expectedRole}, got ${raw.role}`);
  }
  const baseDir = path.dirname(resolvedProfilePath);
  const initTemplatePath = path.resolve(baseDir, raw.init.template);
  const initTemplate = (await fs.readFile(initTemplatePath, "utf8")).trim();
  if (!initTemplate) throw new Error(`role init template empty: ${initTemplatePath}`);
  const turnTemplates = {};
  for (const [templateId, templateConfig] of Object.entries(raw.turnTemplates ?? {})) {
    const templatePath = path.resolve(baseDir, templateConfig.template);
    const templateBody = await fs.readFile(templatePath, "utf8");
    turnTemplates[templateId] = {
      templateId,
      templatePath,
      templateVersion: templateConfig.version,
      templateBody,
      templateHash: sha256(templateBody),
    };
  }
  const loaded = {
    role: raw.role,
    profilePath: resolvedProfilePath,
    profileVersion: raw.profileVersion,
    skillPath: raw.skillPath ?? null,
    init: {
      templatePath: initTemplatePath,
      templateBody: initTemplate,
      templateHash: sha256(initTemplate),
      readyText: raw.init.readyText ?? null,
    },
    turnTemplates,
  };
  profileCache.set(cacheKey, loaded);
  return loaded;
}

function renderTurnTemplate(roleProfile, templateId, values) {
  const template = roleProfile?.turnTemplates?.[templateId];
  if (!template) throw new Error(`role turn template missing: ${roleProfile?.role ?? "unknown"}:${templateId}`);
  const renderedText = template.templateBody.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    if (!(key in values)) {
      throw new Error(`role turn template placeholder missing: ${templateId}:${key}`);
    }
    return String(values[key]);
  });
  return {
    templateId,
    promptTemplateId: templateId,
    promptTemplateVersion: template.templateVersion,
    promptTemplateHash: template.templateHash,
    text: renderedText,
  };
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

module.exports = {
  WORKSPACE_ROOT,
  ROLE_CONFIG_PATH,
  loadRoleProfileByRole,
  loadRoleProfile,
  renderTurnTemplate,
  sha256,
};
