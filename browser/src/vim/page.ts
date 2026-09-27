import type { WebViewHandle } from "@zenbu-labs/pixel";

import { VIM_CHANNEL, VIM_PAGE_SCRIPT } from "./page-script";
import type { HintMode, HintReply } from "./page-script";

const MISSING = "__vim_missing__";
const BINDING = "__pixelEmit";

export interface VimPageHooks {
  editableChanged(editable: boolean): void;
}

export class VimPage {
  private documentScript: string | null = null;
  private listening = false;
  private ensured = false;
  private readonly onMessage = (_event: unknown, method: string, params: unknown) => {
    if (method === "Page.frameNavigated") {
      void this.ensureScript().catch(() => {});
      return;
    }
    if (method !== "Runtime.bindingCalled") return;
    const call = params as { name: string; payload: string };
    if (call.name !== BINDING) return;
    try {
      const message = JSON.parse(call.payload) as { channel: string; data: unknown };
      if (message.channel !== VIM_CHANNEL) return;
      const data = message.data as { type: string; editable?: boolean };
      if (data.type === "editable") this.hooks.editableChanged(!!data.editable);
    } catch {}
  };

  constructor(
    private readonly view: WebViewHandle,
    private readonly hooks: VimPageHooks,
  ) {}

  async activate(): Promise<void> {
    await this.listen();
    await this.ensureScript();
    await this.run(VIM_PAGE_SCRIPT).catch(() => {});
  }

  async deactivate(): Promise<void> {
    await this.clearHints().catch(() => {});
    if (!this.documentScript) return;
    const identifier = this.documentScript;
    this.documentScript = null;
    await this.view.cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier }).catch(() => {});
  }

  dispose(): void {
    if (this.listening) {
      this.listening = false;
      try {
        this.view.webContents.debugger.removeListener("message", this.onMessage);
      } catch {}
    }
    if (this.documentScript) {
      const identifier = this.documentScript;
      this.documentScript = null;
      void this.view
        .cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier })
        .catch(() => {});
    }
  }

  scroll(x: number, y: number, unit: "px" | "page"): Promise<unknown> {
    return this.call(`scroll(${x}, ${y}, ${JSON.stringify(unit)})`);
  }

  scrollEdge(where: "top" | "bottom" | "left" | "right"): Promise<unknown> {
    return this.call(`scrollEdge(${JSON.stringify(where)})`);
  }

  async showHints(): Promise<number> {
    const count = await this.call("showHints()");
    return typeof count === "number" ? count : 0;
  }

  async typeHint(typed: string, mode: HintMode): Promise<HintReply> {
    const reply = await this.call(`typeHint(${JSON.stringify(typed)}, ${JSON.stringify(mode)})`);
    return (reply as HintReply | null) ?? { status: "miss" };
  }

  clearHints(): Promise<unknown> {
    return this.call("clearHints()");
  }

  async focusInput(): Promise<boolean> {
    return (await this.call("focusInput()")) === true;
  }

  blur(): Promise<unknown> {
    return this.call("blur()");
  }

  async editableNow(): Promise<boolean> {
    return (await this.call("editable()").catch(() => false)) === true;
  }

  async click(x: number, y: number): Promise<void> {
    const button = { button: "left", buttons: 1, clickCount: 1, x, y };
    await this.view.cdp("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none",
      buttons: 0,
    });
    await this.view.cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...button });
    await this.view.cdp("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...button,
      buttons: 0,
    });
  }

  private async listen(): Promise<void> {
    if (this.listening) return;
    this.listening = true;
    await this.view.cdp("Runtime.addBinding", { name: BINDING }).catch(() => {});
    this.view.webContents.debugger.on("message", this.onMessage);
  }

  private async ensureScript(): Promise<void> {
    if (!this.documentScript) {
      const added = (await this.view
        .cdp("Page.addScriptToEvaluateOnNewDocument", { source: VIM_PAGE_SCRIPT })
        .catch(() => null)) as { identifier?: string } | null;
      this.documentScript = added?.identifier ?? null;
    }
    if (!this.ensured) {
      this.ensured = true;
      await this.run(VIM_PAGE_SCRIPT).catch(() => {});
    }
  }

  private run(source: string): Promise<unknown> {
    return this.view.webContents.executeJavaScript(source, true);
  }

  private async call(method: string): Promise<unknown> {
    const expression = `(window.__terminalBrowserVim ? window.__terminalBrowserVim.${method} : ${JSON.stringify(MISSING)})`;
    const result = await this.run(expression).catch(() => MISSING);
    if (result !== MISSING) return result;
    this.ensured = false;
    await this.ensureScript().catch(() => {});
    return this.run(expression).catch(() => null);
  }
}
