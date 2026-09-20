import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function parseSummary(summary) {
  return spawnSync("bash", ["infra/deploy/parse-test-failures.sh"], {
    cwd: process.cwd(),
    input: summary,
    encoding: "utf8",
  });
}

test("deploy reconoce el resumen TAP de Node 22", () => {
  const out = parseSummary("# tests 106\n# pass 104\n# fail 2\n");
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout.trim(), "2");
});

test("deploy reconoce el reporter spec de Node 24", () => {
  const out = parseSummary("ℹ tests 106\nℹ pass 101\nℹ fail 5\n");
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout.trim(), "5");
});
