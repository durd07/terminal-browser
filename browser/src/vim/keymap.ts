import type { EngineKeyEvent } from "@zenbu-labs/pixel";

export type VimCommand =
  | "scrollDown"
  | "scrollUp"
  | "scrollLeft"
  | "scrollRight"
  | "scrollHalfDown"
  | "scrollHalfUp"
  | "scrollPageDown"
  | "scrollPageUp"
  | "scrollTop"
  | "scrollBottom"
  | "scrollLeftEdge"
  | "scrollRightEdge"
  | "back"
  | "forward"
  | "reload"
  | "goUp"
  | "goRoot"
  | "openUrl"
  | "openUrlNewTab"
  | "focusInput"
  | "copyUrl"
  | "pasteUrl"
  | "pasteUrlNewTab"
  | "newTab"
  | "closeTab"
  | "restoreTab"
  | "duplicateTab"
  | "prevTab"
  | "nextTab"
  | "firstTab"
  | "lastTab"
  | "moveTabLeft"
  | "moveTabRight"
  | "hintClick"
  | "hintNewTab"
  | "hintCopy"
  | "insert"
  | "find"
  | "findNext"
  | "findPrev"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "help"
  | "escape";

export type VimGroup = "scroll" | "navigate" | "tabs" | "hints" | "find" | "misc";

export interface VimBinding {
  keys: string;
  chords: string[];
  command: VimCommand;
  label: string;
  group: VimGroup;
}

const TABLE: [string, VimCommand, string, VimGroup][] = [
  ["j", "scrollDown", "scroll down", "scroll"],
  ["<down>", "scrollDown", "scroll down", "scroll"],
  ["k", "scrollUp", "scroll up", "scroll"],
  ["<up>", "scrollUp", "scroll up", "scroll"],
  ["h", "scrollLeft", "scroll left", "scroll"],
  ["l", "scrollRight", "scroll right", "scroll"],
  ["d", "scrollHalfDown", "scroll half a page down", "scroll"],
  ["u", "scrollHalfUp", "scroll half a page up", "scroll"],
  ["<space>", "scrollPageDown", "scroll a page down", "scroll"],
  ["<c-f>", "scrollPageDown", "scroll a page down", "scroll"],
  ["<pagedown>", "scrollPageDown", "scroll a page down", "scroll"],
  ["<c-b>", "scrollPageUp", "scroll a page up", "scroll"],
  ["<pageup>", "scrollPageUp", "scroll a page up", "scroll"],
  ["gg", "scrollTop", "scroll to the top", "scroll"],
  ["G", "scrollBottom", "scroll to the bottom", "scroll"],
  ["0", "scrollLeftEdge", "scroll all the way left", "scroll"],
  ["$", "scrollRightEdge", "scroll all the way right", "scroll"],

  ["f", "hintClick", "click a link", "hints"],
  ["F", "hintNewTab", "open a link in a new tab", "hints"],
  ["yf", "hintCopy", "copy a link address", "hints"],

  ["H", "back", "go back", "navigate"],
  ["L", "forward", "go forward", "navigate"],
  ["r", "reload", "reload", "navigate"],
  ["gu", "goUp", "up one path segment", "navigate"],
  ["gU", "goRoot", "to the site root", "navigate"],
  ["o", "openUrl", "open a url here", "navigate"],
  ["O", "openUrlNewTab", "open a url in a new tab", "navigate"],
  ["gi", "focusInput", "focus the first text field", "navigate"],
  ["yy", "copyUrl", "copy this page's url", "navigate"],
  ["p", "pasteUrl", "clipboard url here", "navigate"],
  ["P", "pasteUrlNewTab", "clipboard url in a new tab", "navigate"],

  ["t", "newTab", "new tab", "tabs"],
  ["x", "closeTab", "close this tab", "tabs"],
  ["X", "restoreTab", "reopen the last closed tab", "tabs"],
  ["yt", "duplicateTab", "duplicate this tab", "tabs"],
  ["J", "prevTab", "previous tab", "tabs"],
  ["gT", "prevTab", "previous tab", "tabs"],
  ["K", "nextTab", "next tab", "tabs"],
  ["gt", "nextTab", "next tab", "tabs"],
  ["g0", "firstTab", "first tab", "tabs"],
  ["g$", "lastTab", "last tab", "tabs"],
  ["<<", "moveTabLeft", "move this tab left", "tabs"],
  [">>", "moveTabRight", "move this tab right", "tabs"],

  ["/", "find", "find in page", "find"],
  ["n", "findNext", "next match", "find"],
  ["N", "findPrev", "previous match", "find"],

  ["zi", "zoomIn", "zoom in", "misc"],
  ["zo", "zoomOut", "zoom out", "misc"],
  ["z0", "zoomReset", "reset zoom", "misc"],
  ["i", "insert", "insert mode, keys go to the page", "misc"],
  ["<esc>", "escape", "back to normal mode", "misc"],
  ["?", "help", "show this list", "misc"],
];

export const BINDINGS: VimBinding[] = TABLE.map(([keys, command, label, group]) => ({
  keys,
  chords: chords(keys),
  command,
  label,
  group,
}));

export const GROUP_TITLES: Record<VimGroup, string> = {
  hints: "links",
  scroll: "scrolling",
  navigate: "navigation",
  tabs: "tabs",
  find: "find",
  misc: "misc",
};

export function chords(keys: string): string[] {
  const out: string[] = [];
  let at = 0;
  while (at < keys.length) {
    const close = keys[at] === "<" ? keys.indexOf(">", at) : -1;
    const named = close > at + 1 && /^[a-z0-9-]+$/.test(keys.slice(at + 1, close));
    if (named) {
      out.push(keys.slice(at, close + 1));
      at = close + 1;
    } else {
      out.push(keys[at]);
      at += 1;
    }
  }
  return out;
}

const NAMED_KEYS: Record<string, string> = {
  escape: "<esc>",
  enter: "<cr>",
  tab: "<tab>",
  backspace: "<bs>",
  delete: "<del>",
  up: "<up>",
  down: "<down>",
  left: "<left>",
  right: "<right>",
  home: "<home>",
  end: "<end>",
  pageup: "<pageup>",
  pagedown: "<pagedown>",
};

export function chordOf(event: EngineKeyEvent): string | null {
  const { key, mods, text } = event;
  if (mods.super) return null;
  if (mods.ctrl) {
    if (mods.alt || key.length !== 1) return null;
    return `<c-${key.toLowerCase()}>`;
  }
  if (mods.alt) return null;
  const named = NAMED_KEYS[key];
  if (named) return named;
  const typed = text && [...text].length === 1 ? text : key.length === 1 ? key : null;
  if (typed === null) return null;
  if (typed === " ") return "<space>";
  return mods.shift ? typed.toUpperCase() : typed;
}

export type Lookup =
  | { kind: "run"; binding: VimBinding }
  | { kind: "pending" }
  | { kind: "miss" };

export function lookup(sequence: string[]): Lookup {
  let pending = false;
  for (const binding of BINDINGS) {
    if (binding.chords.length < sequence.length) continue;
    if (!sequence.every((chord, at) => binding.chords[at] === chord)) continue;
    if (binding.chords.length === sequence.length) return { kind: "run", binding };
    pending = true;
  }
  return pending ? { kind: "pending" } : { kind: "miss" };
}

export function startsBinding(chord: string): boolean {
  return BINDINGS.some((binding) => binding.chords[0] === chord);
}

export interface HelpSection {
  title: string;
  rows: { keys: string; label: string }[];
}

const KEY_COLUMN_CHARS = 10;

function spelling(alternatives: string[]): string {
  let keys = alternatives[0];
  for (const extra of alternatives.slice(1)) {
    const wider = `${keys} ${extra}`;
    if (wider.length > KEY_COLUMN_CHARS) break;
    keys = wider;
  }
  return keys;
}

export function helpSections(): HelpSection[] {
  const order: VimGroup[] = ["hints", "scroll", "navigate", "tabs", "find", "misc"];
  return order.map((group) => {
    const rows = new Map<string, string[]>();
    for (const binding of BINDINGS) {
      if (binding.group !== group) continue;
      const spellings = rows.get(binding.label);
      if (spellings) spellings.push(binding.keys);
      else rows.set(binding.label, [binding.keys]);
    }
    return {
      title: GROUP_TITLES[group],
      rows: [...rows].map(([label, alternatives]) => ({
        keys: spelling(alternatives),
        label,
      })),
    };
  });
}
