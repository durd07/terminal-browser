const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { ConfigStore } = require("../dist/config/config.js");
const { Keymap, parseChord, formatChord, chordFromEvent } = require("../dist/config/keys.js");
const { defaultKeys } = require("../dist/config/commands.js");
const { searchUrlFor, searchOrUrl } = require("../dist/url.js");
const { SEARCH_ENGINES, engineBySearch, parseSuggestions } = require("../dist/config/search.js");
const { SettingsManager } = require("../dist/session/settings.js");

const press = (key, mods = {}) => ({
  key,
  kind: "press",
  mods: { super: false, ctrl: false, alt: false, shift: false, ...mods },
});

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-config-"));
  return new ConfigStore({
    settings: path.join(dir, "settings.json"),
    shortcuts: path.join(dir, "shortcuts.json"),
  });
}

test("chords parse modifier aliases and shifted symbols", () => {
  assert.deepEqual(parseChord("Cmd+Shift+F"), {
    super: true,
    ctrl: false,
    alt: false,
    shift: true,
    key: "f",
  });
  assert.deepEqual(parseChord("ctrl++"), parseChord("ctrl+shift+="));
  assert.equal(parseChord("ctrl+"), null);
  assert.equal(parseChord("bogus+x"), null);
  assert.equal(formatChord(parseChord("option+esc"), "linux"), "alt+escape");
  assert.equal(formatChord(parseChord("super+,"), "darwin"), "cmd+,");
});

test("events fold shifted symbols and ignore lone modifiers", () => {
  assert.equal(chordFromEvent(press("leftshift")), null);
  assert.deepEqual(chordFromEvent(press("+", { ctrl: true })), parseChord("ctrl+shift+="));
  assert.deepEqual(chordFromEvent(press(" ")), parseChord("space"));
});

test("keymap matches defaults, overrides, and unbinding", () => {
  const defaults = new Keymap({}, { noSuper: false });
  const [firstDefault] = defaultKeys("settings.open");
  assert.equal(defaults.match(press(parseChord(firstDefault).key, { ctrl: true })), "settings.open");
  assert.equal(defaults.binding("settings.open").modified, false);

  const custom = new Keymap({ "tab.close": ["ctrl+shift+w"], find: null }, { noSuper: false });
  assert.equal(custom.match(press("w", { ctrl: true, shift: true })), "tab.close");
  assert.equal(custom.binding("tab.close").modified, true);
  assert.deepEqual(custom.labels("find"), []);
  assert.equal(custom.match(press("f", { super: true, shift: true })), null);
});

test("keymap swaps super for alt when the terminal cannot report super", () => {
  const noSuper = new Keymap({}, { noSuper: true });
  const macNewTab = new Keymap({}, { noSuper: false }).match(press("t", { super: true }));
  if (macNewTab === "tab.new") {
    assert.equal(noSuper.match(press("t", { alt: true })), "tab.new");
    assert.equal(noSuper.match(press("t", { super: true })), null);
  }
  const forced = new Keymap({ palette: ["cmd+p"] }, { noSuper: true });
  assert.equal(forced.match(press("p", { super: true })), "palette");
});

test("keymap reports conflicts between commands sharing a chord", () => {
  const keymap = new Keymap({ "tab.close": ["ctrl+g"] }, { noSuper: false });
  assert.deepEqual(keymap.conflicts("tab.close"), ["grab.toggle"]);
  assert.deepEqual(keymap.conflicts("grab.toggle"), ["tab.close"]);
  assert.deepEqual(new Keymap({}, { noSuper: false }).conflicts("tab.close"), []);
});

test("vim toggle defaults to ctrl+m and stays rebindable", () => {
  const defaults = new Keymap({}, { noSuper: false });
  assert.deepEqual(defaults.labels("vim.toggle"), ["ctrl+m"]);
  assert.equal(defaults.match(press("m", { ctrl: true })), "vim.toggle");
  const rebound = new Keymap({ "vim.toggle": ["ctrl+;"] }, { noSuper: false });
  assert.equal(rebound.match(press(";", { ctrl: true })), "vim.toggle");
  assert.equal(rebound.match(press("m", { ctrl: true })), null);
});

test("config store round trips settings and shortcuts", () => {
  const store = tempStore();
  assert.deepEqual(store.load().errors, []);
  assert.equal(store.load().settings["search.engine"].includes("%s"), true);

  store.setSetting("search.engine", "https://duckduckgo.com/?q=%s");
  store.setSetting("search.suggestions", "off");
  assert.equal(store.load().settings["search.engine"], "https://duckduckgo.com/?q=%s");
  assert.equal(store.load().settings["search.suggestions"], "off");
  store.setSetting("search.suggestions", undefined);
  assert.equal(store.load().settings["search.suggestions"].includes("google"), true);

  store.setShortcut("tab.close", ["ctrl+shift+w"]);
  store.setShortcut("find", null);
  store.setShortcut("palette", ["ctrl+p", "alt+p"]);
  const raw = JSON.parse(fs.readFileSync(store.files.shortcuts, "utf8"));
  assert.deepEqual(raw, { "tab.close": "ctrl+shift+w", find: null, palette: ["ctrl+p", "alt+p"] });
  assert.deepEqual(store.load().shortcuts, {
    "tab.close": ["ctrl+shift+w"],
    find: null,
    palette: ["ctrl+p", "alt+p"],
  });
  store.setShortcut("find", undefined);
  assert.equal("find" in store.load().shortcuts, false);
});

test("config store keeps unknown keys and refuses to overwrite broken files", () => {
  const store = tempStore();
  fs.mkdirSync(path.dirname(store.files.settings), { recursive: true });
  fs.writeFileSync(store.files.settings, JSON.stringify({ "future.setting": 1, "search.engine": 5 }));
  const loaded = store.load();
  assert.equal(loaded.settings["search.engine"].includes("google"), true);
  assert.equal(loaded.errors.length, 1);
  assert.match(loaded.errors[0], /search\.engine/);
  store.setSetting("search.suggestions", "off");
  assert.equal(JSON.parse(fs.readFileSync(store.files.settings, "utf8"))["future.setting"], 1);
  store.setSetting("search.engine", undefined);
  assert.deepEqual(store.load().errors, []);

  fs.writeFileSync(store.files.shortcuts, "{ not json");
  const broken = store.load();
  assert.equal(broken.errors.length, 1);
  assert.equal(broken.shortcuts, null);
  assert.equal(broken.settings["search.suggestions"], "off");
  assert.throws(() => store.setShortcut("find", null));
  assert.equal(fs.readFileSync(store.files.shortcuts, "utf8"), "{ not json");
});

test("shortcuts report unknown commands and bad values but keep the rest", () => {
  const store = tempStore();
  fs.mkdirSync(path.dirname(store.files.shortcuts), { recursive: true });
  fs.writeFileSync(
    store.files.shortcuts,
    JSON.stringify({ "tab.clsoe": "ctrl+w", find: 7, palette: ["ctrl+p"] }),
  );
  const loaded = store.load();
  assert.deepEqual(loaded.shortcuts, { palette: ["ctrl+p"] });
  assert.equal(loaded.errors.length, 2);
  assert.match(loaded.errors[0], /tab\.clsoe/);
  assert.match(loaded.errors[1], /find/);
  store.setShortcut("find", null);
  assert.equal(JSON.parse(fs.readFileSync(store.files.shortcuts, "utf8")).find, null);
});

test("config store recognises its own writes until someone else edits the file", () => {
  const store = tempStore();
  assert.equal(store.ownContent("settings"), false);
  store.setSetting("search.suggestions", "off");
  assert.equal(store.ownContent("settings"), true);
  fs.writeFileSync(store.files.settings, JSON.stringify({ "search.suggestions": "on" }));
  assert.equal(store.ownContent("settings"), false);
});

const settled = () => new Promise((resolve) => setTimeout(resolve, 400));

test("config watcher reports external edits and ignores the store's own writes", async () => {
  const store = tempStore();
  const changes = [];
  const stop = store.watch((files) => changes.push(files));
  try {
    store.setShortcut("find", null);
    await settled();
    assert.deepEqual(changes, []);

    fs.writeFileSync(store.files.settings, JSON.stringify({ "search.suggestions": "off" }));
    await settled();
    assert.deepEqual(changes, [["settings"]]);

    fs.writeFileSync(store.files.settings, JSON.stringify({ "search.suggestions": "off" }));
    await settled();
    assert.deepEqual(changes, [["settings"]]);
  } finally {
    stop();
  }
});

test("search templates substitute the query", () => {
  const duck = searchUrlFor("https://duckduckgo.com/?q=%s&ia=web");
  assert.equal(duck("a b"), "https://duckduckgo.com/?q=a%20b&ia=web");
  assert.equal(searchUrlFor("https://kagi.com/search?q=")("x"), "https://kagi.com/search?q=x");
  assert.equal(searchOrUrl("hello world", undefined, duck), duck("hello world"));
  assert.equal(searchOrUrl("example.com", undefined, duck), "example.com");
});

test("suggestion feeds parse the OpenSearch array and the Ecosia object shapes", () => {
  assert.deepEqual(parseSuggestions('["term",["termites","terminal"]]'), ["termites", "terminal"]);
  assert.deepEqual(parseSuggestions('{"query":"term","suggestions":["terminix",7,"terms"]}'), ["terminix", "terms"]);
  assert.deepEqual(parseSuggestions("not json"), []);
  assert.deepEqual(parseSuggestions("[]"), []);
});

test("search engine catalog templates carry the query slot", () => {
  for (const engine of SEARCH_ENGINES) {
    assert.ok(engine.search.includes("%s"), engine.id);
    if (engine.suggest) assert.ok(engine.suggest.includes("%s"), engine.id);
  }
  assert.equal(engineBySearch(SEARCH_ENGINES[1].search).id, SEARCH_ENGINES[1].id);
  assert.equal(engineBySearch("https://example.com/?q=%s"), null);
});

function tempManager() {
  const store = tempStore();
  const host = { requestRender() {}, toast() {}, overlayOpened() {}, overlayClosed() {} };
  return { manager: new SettingsManager(host, store.files), store };
}

test("picking an engine carries suggestions along until the user diverges", () => {
  const { manager } = tempManager();
  const [google, duckduckgo, , brave, , , perplexity] = SEARCH_ENGINES;
  assert.equal(manager.get("search.suggestions"), google.suggest);

  manager.actions.set("search.engine", duckduckgo.search);
  assert.equal(manager.get("search.suggestions"), duckduckgo.suggest);

  manager.actions.set("search.engine", perplexity.search);
  assert.equal(manager.get("search.suggestions"), duckduckgo.suggest);

  manager.actions.set("search.engine", duckduckgo.search);
  manager.actions.set("search.suggestions", brave.suggest);
  manager.actions.set("search.engine", google.search);
  assert.equal(manager.get("search.suggestions"), brave.suggest);

  manager.actions.set("search.suggestions", "off");
  manager.actions.set("search.engine", duckduckgo.search);
  assert.equal(manager.get("search.suggestions"), "off");
});

test("recording shows the chord until enter commits it and escape drops it", () => {
  const { manager } = tempManager();
  manager.open();
  manager.actions.recordShortcut("find");
  assert.equal(manager.view().recording.keys, "");

  manager.recordKey(press("k", { ctrl: true }));
  assert.equal(manager.view().recording.keys, "ctrl+k");
  manager.recordKey(press("j", { ctrl: true, shift: true }));
  assert.equal(manager.view().recording.keys, "ctrl+shift+j");
  manager.recordKey(press("escape"));
  assert.equal(manager.view().recording, null);
  assert.notEqual(manager.keymap.label("find"), "ctrl+shift+j");

  manager.actions.recordShortcut("find");
  manager.recordKey(press("enter"));
  assert.notEqual(manager.view().recording, null);
  manager.recordKey(press("k", { ctrl: true }));
  manager.recordKey(press("enter"));
  assert.equal(manager.view().recording, null);
  assert.equal(manager.keymap.label("find"), "ctrl+k");
});

test("shortcuts with chords that do not parse are reported instead of silently unbinding", () => {
  const store = tempStore();
  fs.mkdirSync(path.dirname(store.files.shortcuts), { recursive: true });
  fs.writeFileSync(
    store.files.shortcuts,
    JSON.stringify({ find: "ctrll+f", palette: ["ctrl+p", "bogus++x"], "tab.new": "ctrl+t" }),
  );
  const loaded = store.load();
  assert.deepEqual(loaded.shortcuts, { "tab.new": ["ctrl+t"] });
  assert.equal(loaded.errors.length, 2);
  assert.match(loaded.errors[0], /find/);
  assert.match(loaded.errors[1], /palette › 1/);
  const keymap = new Keymap(loaded.shortcuts, { noSuper: false });
  assert.notEqual(keymap.label("find"), "");
});
