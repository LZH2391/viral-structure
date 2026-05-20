const { spawnSync } = require("child_process");

const suites = process.argv.slice(2);
const patterns = suites.length ? suites : ["Tests/unit/*.test.js", "Tests/contract/*.test.js"];
const result = spawnSync(process.execPath, ["--test", ...patterns], { stdio: "inherit" });
process.exit(result.status ?? 1);
