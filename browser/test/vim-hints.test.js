const assert = require("node:assert/strict");
const { test } = require("node:test");

const { VIM_PAGE_SCRIPT } = require("../dist/vim/page-script.js");

function dropWrappers() {
  const start = VIM_PAGE_SCRIPT.indexOf("const dropWrappers = ");
  const end = VIM_PAGE_SCRIPT.indexOf("\n  const hintLabels");
  assert.notEqual(start, -1, "dropWrappers is in the page script");
  assert.ok(end > start, "dropWrappers ends before hintLabels");
  return new Function(`${VIM_PAGE_SCRIPT.slice(start, end)}; return dropWrappers;`)();
}

function el(kids = []) {
  const node = {
    kids,
    contains(other) {
      return other === node || kids.some((kid) => kid.contains(other));
    },
  };
  return node;
}

const filter = dropWrappers();

function hintLabels() {
  const chars = VIM_PAGE_SCRIPT.match(/const HINT_CHARS = "[^"]+";/);
  assert.ok(chars, "HINT_CHARS is in the page script");
  const start = VIM_PAGE_SCRIPT.indexOf("\n  const hintLabels");
  const end = VIM_PAGE_SCRIPT.indexOf("\n  const OVERLAY_CSS");
  assert.ok(start !== -1 && end > start, "hintLabels ends before OVERLAY_CSS");
  return new Function(`${chars[0]}${VIM_PAGE_SCRIPT.slice(start, end)}; return hintLabels;`)();
}

const labelsFor = hintLabels();

test("hint labels are prefix-free so every hint stays reachable", () => {
  for (let count = 1; count <= 300; count++) {
    const labels = labelsFor(count);
    assert.equal(labels.length, count);
    for (const label of labels) {
      assert.ok(label.length > 0, "labels are never empty");
      for (const other of labels) {
        if (other === label) continue;
        assert.ok(!other.startsWith(label), `${label} is a prefix of ${other} (count=${count})`);
      }
    }
  }
});

test("a link wrapping an icon keeps one hint", () => {
  const img = el();
  const a = el([img]);
  const kept = filter([
    { node: a, named: true },
    { node: img, named: false },
  ]);
  assert.deepEqual(kept.map((entry) => entry.node), [a]);
});

test("a pointer wrapper around a real control is dropped", () => {
  const a = el();
  const wrap = el([a]);
  const kept = filter([
    { node: wrap, named: false },
    { node: a, named: true },
  ]);
  assert.deepEqual(kept.map((entry) => entry.node), [a]);
});

test("a named button inside a named link keeps both", () => {
  const button = el();
  const a = el([button]);
  const kept = filter([
    { node: a, named: true },
    { node: button, named: true },
  ]);
  assert.equal(kept.length, 2);
});

test("an unnamed pointer tree keeps the innermost node", () => {
  const inner = el();
  const outer = el([inner]);
  const kept = filter([
    { node: outer, named: false },
    { node: inner, named: false },
  ]);
  assert.deepEqual(kept.map((entry) => entry.node), [inner]);
});
