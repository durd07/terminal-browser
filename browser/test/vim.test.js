const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Vim } = require("../dist/vim/vim.js");

const press = (key, mods = {}, text) => ({
  key,
  kind: "press",
  text,
  mods: { shift: false, alt: false, ctrl: false, super: false, ...mods },
});
const release = (key) => ({
  key,
  kind: "release",
  mods: { shift: false, alt: false, ctrl: false, super: false },
});

function host(overrides = {}) {
  const calls = [];
  return {
    calls,
    page: () => null,
    back: () => calls.push("back"),
    forward: () => calls.push("forward"),
    reload: () => calls.push("reload"),
    currentUrl: () => "https://example.com/",
    navigate: (url) => calls.push(`navigate:${url}`),
    openUrlPrompt: (newTab) => calls.push(`prompt:${newTab}`),
    newTab: (url) => calls.push(`newTab:${url ?? ""}`),
    closeTab: () => calls.push("closeTab"),
    restoreTab: () => calls.push("restoreTab"),
    duplicateTab: () => calls.push("duplicateTab"),
    stepTab: (delta) => calls.push(`step:${delta}`),
    edgeTab: (last) => calls.push(`edge:${last}`),
    moveTab: (delta) => calls.push(`move:${delta}`),
    openFind: () => calls.push("find"),
    findNext: (forward) => calls.push(`findNext:${forward}`),
    zoom: (direction) => calls.push(`zoom:${direction}`),
    copy: (text) => calls.push(`copy:${text}`),
    clipboard: async () => "",
    toast: (text) => calls.push(`toast:${text}`),
    render: () => calls.push("render"),
    ...overrides,
  };
}

test("disabled vim lets every key reach the page", () => {
  const h = host();
  const vim = new Vim(h);
  assert.equal(vim.view(), null);
  assert.equal(vim.handleKey(press("j")), false);
  assert.equal(vim.handleKey(release("j")), false);
});

test("a count prefixes the scroll and a miss clears the sequence", () => {
  const scrolled = [];
  const h = host();
  const vim = new Vim({ ...h, page: () => ({ blur: async () => {}, scroll: (x, y, unit) => scrolled.push([x, y, unit]) }) });
  vim.enable();
  assert.equal(vim.handleKey(press("3")), true);
  assert.equal(vim.view().pending, "3");
  assert.equal(vim.handleKey(press("j")), true);
  assert.deepEqual(scrolled, [[0, 192, "px"]]);
  assert.equal(vim.view().pending, "");
  vim.handleKey(press("g"));
  assert.equal(vim.view().pending, "g");
  vim.handleKey(press("q"));
  assert.equal(vim.view().pending, "");
});

test("gg scrolls to the top and G to the bottom", () => {
  const edges = [];
  const h = host();
  const vim = new Vim({ ...h, page: () => ({ blur: async () => {}, scrollEdge: (where) => edges.push(where) }) });
  vim.enable();
  vim.handleKey(press("g"));
  vim.handleKey(press("g"));
  vim.handleKey(press("G", { shift: true }, "G"));
  assert.deepEqual(edges, ["top", "bottom"]);
});

test("insert mode passes keys through until escape", () => {
  const h = host();
  const vim = new Vim(h);
  vim.enable();
  assert.equal(vim.handleKey(press("i")), true);
  assert.equal(vim.view().mode, "insert");
  assert.equal(vim.handleKey(press("j")), false);
  assert.equal(vim.handleKey(press("escape")), true);
  assert.equal(vim.view().mode, "normal");
});

test("swallowed presses eat their releases", () => {
  const h = host();
  const vim = new Vim(h);
  vim.enable();
  assert.equal(vim.handleKey(press("j")), true);
  assert.equal(vim.handleKey(release("j")), true);
  assert.equal(vim.handleKey(release("t")), false);
});

test("help opens on ? and any key closes it", () => {
  const h = host();
  const vim = new Vim(h);
  vim.enable();
  vim.handleKey(press("/", { shift: true }, "?"));
  assert.equal(vim.view().help, true);
  assert.equal(vim.handleKey(press("j")), true);
  assert.equal(vim.view().help, false);
  assert.deepEqual(h.calls.filter((call) => call.startsWith("toast")), []);
});

test("tab commands route to the host", () => {
  const h = host();
  const vim = new Vim(h);
  vim.enable();
  vim.handleKey(press("t"));
  vim.handleKey(press("x"));
  vim.handleKey(press("J", { shift: true }, "J"));
  assert.ok(h.calls.includes("newTab:"));
  assert.ok(h.calls.includes("closeTab"));
  assert.ok(h.calls.includes("step:-1"));
});

test("hints start on f and escape backs out", async () => {
  const cleared = [];
  const h = host();
  const page = {
    showHints: async () => 3,
    typeHint: async () => ({ status: "typing", matches: 2 }),
    clearHints: async () => cleared.push(true),
    blur: async () => {},
  };
  const vim = new Vim({ ...h, page: () => page });
  vim.enable();
  vim.handleKey(press("f"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(vim.view().mode, "hints");
  vim.handleKey(press("escape"));
  assert.equal(vim.view().mode, "normal");
  assert.equal(cleared.length, 1);
});

test("a single hint match clicks through", async () => {
  const clicked = [];
  const h = host();
  const page = {
    showHints: async () => 1,
    typeHint: async () => ({ status: "activated", outcome: { kind: "point", x: 10, y: 20 } }),
    clearHints: async () => {},
    click: async (x, y) => clicked.push([x, y]),
    blur: async () => {},
  };
  const vim = new Vim({ ...h, page: () => page });
  vim.enable();
  vim.handleKey(press("f"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  vim.handleKey(press("a"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(clicked, [[10, 20]]);
  assert.equal(vim.view().mode, "normal");
});
