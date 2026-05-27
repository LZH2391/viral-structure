const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

function read(root, file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function readPropertyPanelCss(root) {
  return [
    "Apps/Workbench/styles/property-panel.css",
    "Apps/Workbench/styles/property-panel-agent.css",
    "Apps/Workbench/styles/property-panel-rhythm.css",
  ].map((file) => read(root, file)).join("\n");
}

module.exports = { test, assert, fs, path, vm, ts, read, readPropertyPanelCss };
