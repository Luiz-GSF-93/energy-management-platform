const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  Module = require("node:module"),
  ts = require("typescript");
const React = require("react"),
  { createRoot } = require("react-dom/client"),
  { JSDOM } = require("jsdom");
const dom = new JSDOM('<div id="root"></div>', { url: "https://test.local" });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
let draws = [],
  images = [],
  applied = [],
  closed = 0,
  checks = 0;
dom.window.HTMLCanvasElement.prototype.getContext = function () {
  return {
    clearRect() {},
    drawImage(...args) {
      draws.push(args.slice(1));
    },
  };
};
dom.window.HTMLCanvasElement.prototype.toDataURL = function (type) {
  assert.equal(type, "image/png");
  return "data:image/png;base64,test-only";
};
global.Image = class {
  constructor() {
    this.naturalWidth = 300;
    this.naturalHeight = 1200;
    images.push(this);
  }
  set src(value) {
    this.source = value;
  }
};
let ownName = "Luiz G Santos F";
const ui = {
  Alert: ({ children }) =>
    React.createElement("p", { role: "alert" }, children),
  Button: ({ variant, ...p }) => React.createElement("button", p),
  Input: ({ label, ...p }) =>
    React.createElement(
      "label",
      null,
      label,
      React.createElement("input", { "aria-label": label, ...p }),
    ),
};
const cache = {};
function load(file) {
  const absolute = path.join(__dirname, "..", file);
  if (cache[absolute]) return cache[absolute].exports;
  const m = new Module(absolute, module);
  m.filename = absolute;
  m.paths = module.paths;
  cache[absolute] = m;
  m.require = (id) =>
    id === "./ui"
      ? ui
      : id === "@/app/lib/avatar-frame"
        ? load("app/lib/avatar-frame.ts")
        : id === "@/app/providers/UserEnvironmentProvider"
          ? {
              useUserEnvironment: () => ({
                account: {
                  identity: { name: ownName },
                  preferences: { avatar_kind: "initials" },
                },
              }),
            }
          : id === "@/app/lib/account"
            ? load("app/lib/account.ts")
            : id === "./api/client"
              ? {
                  apiRequest: () => {
                    throw new Error("Unexpected network");
                  },
                }
              : id === "next/link"
                ? ({ children, ...p }) => React.createElement("a", p, children)
                : module.require(id);
  m._compile(
    ts.transpileModule(fs.readFileSync(absolute, "utf8"), {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
    absolute,
  );
  return m.exports;
}
function check(value) {
  assert.ok(value);
  checks++;
}
const root = createRoot(document.getElementById("root"));
const Photo = load("app/components/PhotoFraming.tsx").default;
const render = (source) =>
  root.render(
    React.createElement(Photo, {
      key: source,
      source,
      onApply: (p) => applied.push(p),
      onClose: () => closed++,
    }),
  );
const button = (name) =>
  Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === name,
  );
(async () => {
  await React.act(async () => render("portrait-test"));
  check(document.querySelector("dialog").open);
  check(button("Aplicar enquadramento").disabled);
  check(applied.length === 0);
  await React.act(async () => images[0].onload());
  check(!button("Aplicar enquadramento").disabled);
  check(draws.length === 1);
  const whole = draws[0];
  check(whole[2] / whole[3] === 0.25);
  const x = [whole[0], whole[0] + whole[2]],
    y = [whole[1], whole[1] + whole[3]];
  check(
    x.every((px) => y.every((py) => Math.hypot(px - 64, py - 64) <= 64 + 1e-8)),
  );
  await React.act(async () => button("Aplicar enquadramento").click());
  check(applied.length === 1 && applied[0].startsWith("data:image/png;"));
  check(!applied[0].includes("portrait-test"));
  await React.act(async () =>
    document
      .querySelector("dialog")
      .dispatchEvent(new window.Event("cancel", { bubbles: true })),
  );
  check(closed === 1);
  check(applied.length === 1);
  await React.act(async () => render("invalid-photo"));
  const invalid = images.at(-1);
  invalid.naturalWidth = 0;
  await React.act(async () => invalid.onload());
  check(!!document.querySelector("[role=alert]"));
  check(button("Aplicar enquadramento").disabled);
  await React.act(async () => render("late-image"));
  const late = images.at(-1);
  await React.act(async () => render("next-image"));
  await React.act(async () => late.onload());
  check(button("Aplicar enquadramento").disabled);
  const { UserWelcome } = load("app/components/UserIdentity.tsx");
  await React.act(async () => root.render(React.createElement(UserWelcome)));
  check(document.body.textContent.includes("Olá, Luiz!"));
  check(!document.body.textContent.includes("Administrador"));
  ownName = "Administrador";
  await React.act(async () => root.render(React.createElement(UserWelcome)));
  check(document.body.textContent.includes("Olá, Administrador!"));
  await React.act(async () => root.unmount());
  console.log(
    "Photo framing UI:",
    checks,
    "checks passed; preview, explicit apply/cancel, invalid/stale image and separate account greetings",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
