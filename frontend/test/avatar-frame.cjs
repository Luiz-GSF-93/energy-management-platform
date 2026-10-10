const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const Module = require("node:module");
const mod = new Module(__filename, module);
mod.filename = __filename;
mod.paths = module.paths;
mod._compile(
  ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../app/lib/avatar-frame.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  __filename,
);
const { avatarFrame, initialPlacement } = mod.exports;
let checks = 0;
for (const [w, h] of [
  [400, 400],
  [300, 1200],
  [1600, 300],
  [128, 128],
]) {
  const r = avatarFrame(w, h, initialPlacement);
  assert.ok(Math.abs(r.width / r.height - w / h) < 1e-9);
  checks++;
  for (const x of [r.left, r.left + r.width])
    for (const y of [r.top, r.top + r.height]) {
      assert.ok(Math.hypot(x - 64, y - 64) <= 64 + 1e-8);
      checks++;
    }
}
const full = avatarFrame(300, 1200, initialPlacement),
  zoom = avatarFrame(300, 1200, { zoom: 2, x: 0, y: 0 }),
  moved = avatarFrame(300, 1200, { zoom: 2, x: 0.5, y: -0.5 });
assert.equal(zoom.width, full.width * 2);
checks++;
assert.equal(moved.left - zoom.left, 32);
checks++;
assert.equal(moved.top - zoom.top, -32);
checks++;
for (const value of [
  { zoom: 0, x: 0, y: 0 },
  { zoom: 5, x: 0, y: 0 },
  { zoom: 1, x: 2, y: 0 },
  { zoom: 1, x: 0, y: NaN },
]) {
  assert.throws(() => avatarFrame(10, 20, value));
  checks++;
}
assert.throws(() => avatarFrame(0, 20, initialPlacement));
checks++;
console.log(
  "Avatar framing:",
  checks,
  "checks passed (real geometry, all corners inside circular preview, zoom, positions and invalid input)",
);
