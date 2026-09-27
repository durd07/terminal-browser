const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  BINDINGS,
  chords,
  chordOf,
  helpSections,
  lookup,
  startsBinding,
} = require("../dist/vim/keymap.js");

const press = (key, mods = {}, text) => ({
  key,
  kind: "press",
  text,
  mods: { shift: false, alt: false, ctrl: false, super: false, ...mods },
});

test("a sequence splits into one chord per key press", () => {
  assert.deepEqual(chords("gg"), ["g", "g"]);
  assert.deepEqual(chords("yf"), ["y", "f"]);
  assert.deepEqual(chords("<esc>"), ["<esc>"]);
  assert.deepEqual(chords("<c-f>"), ["<c-f>"]);
  assert.deepEqual(chords("<<"), ["<", "<"], "a bare < is a literal, not an unterminated name");
  assert.deepEqual(chords("g$"), ["g", "$"]);
});

test("no binding is a prefix of another, so every sequence is reachable", () => {
  for (const binding of BINDINGS) {
    for (const other of BINDINGS) {
      if (other === binding || other.chords.length <= binding.chords.length) continue;
      const shadowed = binding.chords.every((chord, at) => other.chords[at] === chord);
      assert.ok(
        !shadowed,
        `${binding.keys} runs before ${other.keys} can ever be typed`,
      );
    }
  }
});

test("lookup waits for the rest of a sequence, then runs it", () => {
  assert.equal(lookup(["g"]).kind, "pending");
  const found = lookup(["g", "g"]);
  assert.equal(found.kind, "run");
  assert.equal(found.binding.command, "scrollTop");
  assert.equal(lookup(["g", "q"]).kind, "miss");
  assert.equal(lookup(["j"]).kind, "run");
});

test("startsBinding only claims keys a sequence can begin with", () => {
  assert.equal(startsBinding("g"), true);
  assert.equal(startsBinding("<c-f>"), true);
  assert.equal(startsBinding("<c-a>"), false, "unbound ctrl chords belong to the page");
});

test("a shifted letter is the uppercase chord either way the terminal reports it", () => {
  assert.equal(chordOf(press("f")), "f");
  assert.equal(chordOf(press("f", { shift: true }, "F")), "F", "kitty: base key plus text");
  assert.equal(chordOf(press("F")), "F", "legacy: the shifted byte on its own");
});

test("punctuation comes from the text the terminal sends, not the unshifted key", () => {
  assert.equal(chordOf(press(",", { shift: true }, "<")), "<");
  assert.equal(chordOf(press("4", { shift: true }, "$")), "$");
  assert.equal(chordOf(press("/", { shift: true }, "?")), "?");
  assert.equal(chordOf(press("/")), "/");
});

test("named keys and ctrl chords have vim spellings, super and alt have none", () => {
  assert.equal(chordOf(press("escape")), "<esc>");
  assert.equal(chordOf(press("pagedown")), "<pagedown>");
  assert.equal(chordOf(press(" ", {}, " ")), "<space>");
  assert.equal(chordOf(press("f", { ctrl: true })), "<c-f>");
  assert.equal(chordOf(press("f", { super: true })), null);
  assert.equal(chordOf(press("f", { alt: true })), null);
  assert.equal(chordOf(press("leftshift")), null);
});

test("the help overlay lists a way to reach every command", () => {
  const listed = new Set(
    helpSections().flatMap((section) => section.rows.flatMap((row) => row.keys.split(" "))),
  );
  const reachable = new Set(
    BINDINGS.filter((binding) => listed.has(binding.keys)).map((binding) => binding.command),
  );
  for (const binding of BINDINGS) {
    assert.ok(reachable.has(binding.command), `${binding.command} is missing from the help`);
  }
});
