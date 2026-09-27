import type { EngineKeyEvent } from "@zenbu-labs/pixel";
import type { ZoomDirection } from "../zoom";
import { chordOf, lookup, startsBinding } from "./keymap";
import type { VimCommand } from "./keymap";
import type { HintMode, HintOutcome } from "./page-script";
import type { VimPage } from "./page";

export type VimMode = "normal" | "insert" | "hints";

const LINE_PX = 64;
const HALF_PAGE = 0.5;
const FULL_PAGE = 0.95;

export interface VimHost {
  page(): VimPage | null;
  back(): void;
  forward(): void;
  reload(): void;
  currentUrl(): string;
  navigate(url: string): void;
  openUrlPrompt(newTab: boolean): void;
  newTab(url?: string): void;
  closeTab(): void;
  restoreTab(): void;
  duplicateTab(): void;
  stepTab(delta: number): void;
  edgeTab(last: boolean): void;
  moveTab(delta: number): void;
  openFind(): void;
  findNext(forward: boolean): void;
  zoom(direction: ZoomDirection): void;
  copy(text: string): void;
  clipboard(): Promise<string>;
  toast(text: string, state: "done" | "failed" | "alert"): void;
  render(): void;
}

export interface VimView {
  mode: VimMode;
  pending: string;
  help: boolean;
}

export class Vim {
  private on = false;
  private mode: VimMode = "normal";
  private sequence: string[] = [];
  private count = "";
  private hintMode: HintMode = "click";
  private hintTyped = "";
  private hintSeq = 0;
  private helpOpen = false;
  private swallowed = new Set<string>();

  constructor(private readonly host: VimHost) {}

  get enabled(): boolean {
    return this.on;
  }

  view(): VimView | null {
    if (!this.on) return null;
    const pending = this.mode === "hints" ? this.hintTyped : this.count + this.sequence.join("");
    return { mode: this.mode, pending, help: this.helpOpen };
  }

  toggle(): void {
    if (this.on) this.disable();
    else this.enable();
  }

  enable(): void {
    if (this.on) return;
    this.on = true;
    this.reset();
    const page = this.host.page();
    void page?.blur();
    this.host.render();
  }

  disable(): void {
    if (!this.on) return;
    this.on = false;
    void this.host.page()?.clearHints();
    this.reset();
    this.host.render();
  }

  closeHelp(): void {
    if (!this.helpOpen) return;
    this.helpOpen = false;
    this.host.render();
  }

  editableChanged(editable: boolean): void {
    if (!this.on || this.mode === "hints") return;
    if (editable === (this.mode === "insert")) return;
    this.mode = editable ? "insert" : "normal";
    this.host.render();
  }

  /** true when the key belongs to the mode and must not reach the page */
  handleKey(event: EngineKeyEvent): boolean {
    if (!this.on) return false;
    if (event.kind === "release") return this.swallowed.delete(event.key);
    const chord = chordOf(event);
    if (chord === null) return false;
    if (this.helpOpen) {
      this.helpOpen = false;
      this.host.render();
      return this.swallow(event);
    }
    if (this.mode === "insert") {
      if (chord !== "<esc>") return false;
      this.leaveInsert();
      return this.swallow(event);
    }
    if (this.mode === "hints") {
      this.hintKey(chord);
      return this.swallow(event);
    }
    if (event.mods.ctrl && !startsBinding(chord) && this.sequence.length === 0) return false;
    this.normalKey(chord);
    return this.swallow(event);
  }

  private swallow(event: EngineKeyEvent): boolean {
    this.swallowed.add(event.key);
    return true;
  }

  private reset(): void {
    this.mode = "normal";
    this.sequence = [];
    this.count = "";
    this.hintTyped = "";
    this.helpOpen = false;
    this.swallowed.clear();
  }

  private leaveInsert(): void {
    this.mode = "normal";
    void this.host.page()?.blur();
    this.host.render();
  }

  private normalKey(chord: string): void {
    if (this.sequence.length === 0 && /^[1-9]$/.test(chord)) {
      this.count += chord;
      this.host.render();
      return;
    }
    if (this.sequence.length === 0 && chord === "0" && this.count) {
      this.count += chord;
      this.host.render();
      return;
    }
    this.sequence.push(chord);
    const found = lookup(this.sequence);
    if (found.kind === "pending") {
      this.host.render();
      return;
    }
    const binding = found.kind === "run" ? found.binding : null;
    const count = Number(this.count) || 1;
    this.sequence = [];
    this.count = "";
    if (binding) this.run(binding.command, count);
    this.host.render();
  }

  private hintKey(chord: string): void {
    if (chord === "<esc>") {
      this.mode = "normal";
      this.hintTyped = "";
      this.hintSeq++;
      void this.host.page()?.clearHints();
      this.host.render();
      return;
    }
    if (chord === "<bs>") {
      if (!this.hintTyped) return;
      this.hintTyped = this.hintTyped.slice(0, -1);
      void this.sendHint();
      return;
    }
    if (!/^[a-z]$/.test(chord)) return;
    this.hintTyped += chord;
    void this.sendHint();
  }

  private async sendHint(): Promise<void> {
    const page = this.host.page();
    if (!page) return;
    const seq = ++this.hintSeq;
    const typed = this.hintTyped;
    const reply = await page.typeHint(typed, this.hintMode).catch(() => null);
    if (!reply || seq !== this.hintSeq) return;
    if (reply.status === "miss") {
      this.hintTyped = typed.slice(0, -1);
      this.host.render();
      return;
    }
    if (reply.status === "typing") {
      this.host.render();
      return;
    }
    this.mode = "normal";
    this.hintTyped = "";
    await this.finishHint(reply.outcome);
    this.host.render();
  }

  private async finishHint(outcome: HintOutcome): Promise<void> {
    switch (outcome.kind) {
      case "point":
        await this.host.page()?.click(outcome.x, outcome.y);
        return;
      case "url":
        if (this.hintMode === "tab") this.host.newTab(outcome.url);
        else {
          this.host.copy(outcome.url);
          this.host.toast("copied link", "done");
        }
        return;
      case "editable":
        this.mode = "insert";
        return;
      case "none":
        this.host.toast("that is not a link", "alert");
        return;
      case "done":
        return;
    }
  }

  private async startHints(mode: HintMode): Promise<void> {
    const page = this.host.page();
    if (!page) return;
    const count = await page.showHints().catch(() => 0);
    if (count === 0) {
      this.host.toast("nothing to click here", "alert");
      return;
    }
    this.mode = "hints";
    this.hintMode = mode;
    this.hintTyped = "";
    this.hintSeq++;
    this.host.render();
  }

  private scroll(x: number, y: number, unit: "px" | "page"): void {
    void this.host.page()?.scroll(x, y, unit);
  }

  private async openClipboardUrl(newTab: boolean): Promise<void> {
    const text = (await this.host.clipboard()).trim();
    if (!text) {
      this.host.toast("the clipboard is empty", "alert");
      return;
    }
    if (newTab) this.host.newTab(text);
    else this.host.navigate(text);
  }

  private goUp(root: boolean): void {
    let url: URL;
    try {
      url = new URL(this.host.currentUrl());
    } catch {
      return;
    }
    if (root) {
      this.host.navigate(url.origin);
      return;
    }
    if (url.search || url.hash) {
      this.host.navigate(url.origin + url.pathname);
      return;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    parts.pop();
    this.host.navigate(`${url.origin}/${parts.join("/")}`);
  }

  private run(command: VimCommand, count: number): void {
    switch (command) {
      case "scrollDown":
        return this.scroll(0, LINE_PX * count, "px");
      case "scrollUp":
        return this.scroll(0, -LINE_PX * count, "px");
      case "scrollLeft":
        return this.scroll(-LINE_PX * count, 0, "px");
      case "scrollRight":
        return this.scroll(LINE_PX * count, 0, "px");
      case "scrollHalfDown":
        return this.scroll(0, HALF_PAGE * count, "page");
      case "scrollHalfUp":
        return this.scroll(0, -HALF_PAGE * count, "page");
      case "scrollPageDown":
        return this.scroll(0, FULL_PAGE * count, "page");
      case "scrollPageUp":
        return this.scroll(0, -FULL_PAGE * count, "page");
      case "scrollTop":
        void this.host.page()?.scrollEdge("top");
        return;
      case "scrollBottom":
        void this.host.page()?.scrollEdge("bottom");
        return;
      case "scrollLeftEdge":
        void this.host.page()?.scrollEdge("left");
        return;
      case "scrollRightEdge":
        void this.host.page()?.scrollEdge("right");
        return;
      case "back":
        for (let at = 0; at < count; at++) this.host.back();
        return;
      case "forward":
        for (let at = 0; at < count; at++) this.host.forward();
        return;
      case "reload":
        return this.host.reload();
      case "goUp":
        return this.goUp(false);
      case "goRoot":
        return this.goUp(true);
      case "openUrl":
        return this.host.openUrlPrompt(false);
      case "openUrlNewTab":
        return this.host.openUrlPrompt(true);
      case "focusInput":
        void this.host.page()?.focusInput();
        return;
      case "copyUrl":
        this.host.copy(this.host.currentUrl());
        this.host.toast("copied url", "done");
        return;
      case "pasteUrl":
        void this.openClipboardUrl(false);
        return;
      case "pasteUrlNewTab":
        void this.openClipboardUrl(true);
        return;
      case "newTab":
        return this.host.newTab();
      case "closeTab":
        return this.host.closeTab();
      case "restoreTab":
        return this.host.restoreTab();
      case "duplicateTab":
        return this.host.duplicateTab();
      case "prevTab":
        return this.host.stepTab(-count);
      case "nextTab":
        return this.host.stepTab(count);
      case "firstTab":
        return this.host.edgeTab(false);
      case "lastTab":
        return this.host.edgeTab(true);
      case "moveTabLeft":
        return this.host.moveTab(-count);
      case "moveTabRight":
        return this.host.moveTab(count);
      case "hintClick":
        void this.startHints("click");
        return;
      case "hintNewTab":
        void this.startHints("tab");
        return;
      case "hintCopy":
        void this.startHints("copy");
        return;
      case "insert":
        this.mode = "insert";
        return;
      case "find":
        return this.host.openFind();
      case "findNext":
        return this.host.findNext(true);
      case "findPrev":
        return this.host.findNext(false);
      case "zoomIn":
        return this.host.zoom(1);
      case "zoomOut":
        return this.host.zoom(-1);
      case "zoomReset":
        return this.host.zoom(0);
      case "help":
        this.helpOpen = true;
        return;
      case "escape":
        this.hintTyped = "";
        return;
    }
  }
}
