export const VIM_CHANNEL = "vim";

export type HintMode = "click" | "tab" | "copy";

export type HintOutcome =
  | { kind: "point"; x: number; y: number }
  | { kind: "url"; url: string }
  | { kind: "editable" }
  | { kind: "none" }
  | { kind: "done" };

export type HintReply =
  | { status: "typing"; matches: number }
  | { status: "miss" }
  | { status: "activated"; outcome: HintOutcome };

/**
 * Runs inside the page. Everything the mode needs from the DOM lives here so a
 * keystroke costs one round trip: hints, scrolling, and focus reporting.
 */
export const VIM_PAGE_SCRIPT = String.raw`(() => {
  if (window.__terminalBrowserVim) return "ready";

  const CHANNEL = "vim";
  const HINT_CHARS = "sadfjklewcmpgh";
  const ACTIONABLE_ROLES = new Set([
    "button", "link", "checkbox", "radio", "menuitem", "menuitemcheckbox", "menuitemradio",
    "tab", "option", "switch", "treeitem", "combobox", "textbox", "searchbox", "slider",
    "spinbutton", "listbox",
  ]);
  const NON_TEXT_INPUTS = new Set([
    "button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit",
  ]);

  const emit = (data) => {
    try {
      if (window.__pixelEmit) window.__pixelEmit(JSON.stringify({ channel: CHANNEL, data }));
    } catch (error) {}
  };

  const deepActive = (doc) => {
    let node = doc.activeElement;
    while (node && node.shadowRoot && node.shadowRoot.activeElement) {
      node = node.shadowRoot.activeElement;
    }
    return node;
  };

  const isEditable = (node) => {
    if (!node) return false;
    if (node.isContentEditable) return true;
    const tag = node.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag !== "INPUT") return false;
    return !NON_TEXT_INPUTS.has(String(node.type || "text").toLowerCase());
  };

  const parentOf = (node) => {
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode();
    return root && root.host ? root.host : null;
  };

  const scrollRoot = () => document.scrollingElement || document.documentElement;

  const roomToScroll = (node, dx, dy) => {
    if (dy < 0 && node.scrollTop <= 0) return false;
    if (dy > 0 && node.scrollTop + node.clientHeight >= node.scrollHeight - 1) return false;
    if (dx < 0 && node.scrollLeft <= 0) return false;
    if (dx > 0 && node.scrollLeft + node.clientWidth >= node.scrollWidth - 1) return false;
    return true;
  };

  const overflows = (node, dx, dy) => {
    const style = getComputedStyle(node);
    const overflow = dy !== 0 ? style.overflowY : style.overflowX;
    if (overflow === "visible" || overflow === "hidden" || overflow === "clip") return false;
    return roomToScroll(node, dx, dy);
  };

  const largestScroller = (dx, dy) => {
    let best = null;
    let bestArea = 0;
    for (const node of document.querySelectorAll("*")) {
      const area = node.clientWidth * node.clientHeight;
      if (area < innerWidth * innerHeight * 0.25 || area <= bestArea) continue;
      if (!overflows(node, dx, dy)) continue;
      best = node;
      bestArea = area;
    }
    return best;
  };

  const scroller = (dx, dy) => {
    let node = deepActive(document);
    while (node && node !== document.body && node !== document.documentElement) {
      if (node.nodeType === 1 && overflows(node, dx, dy)) return node;
      node = parentOf(node);
    }
    const root = scrollRoot();
    if (roomToScroll(root, dx, dy)) return root;
    return largestScroller(dx, dy) || root;
  };

  const scroll = (x, y, unit) => {
    const target = scroller(Math.sign(x), Math.sign(y));
    target.scrollLeft += unit === "page" ? x * target.clientWidth : x;
    target.scrollTop += unit === "page" ? y * target.clientHeight : y;
    return true;
  };

  const scrollEdge = (where) => {
    const vertical = where === "top" || where === "bottom";
    const toEnd = where === "bottom" || where === "right";
    const target = scroller(vertical ? 0 : toEnd ? 1 : -1, vertical ? (toEnd ? 1 : -1) : 0);
    if (vertical) target.scrollTop = toEnd ? target.scrollHeight : 0;
    else target.scrollLeft = toEnd ? target.scrollWidth : 0;
    return true;
  };

  const onScreen = (rect, offsetX, offsetY) => {
    const left = rect.left + offsetX;
    const top = rect.top + offsetY;
    return (
      rect.width >= 2 &&
      rect.height >= 2 &&
      left < innerWidth &&
      top < innerHeight &&
      left + rect.width > 0 &&
      top + rect.height > 0
    );
  };

  const namedClickable = (node) => {
    const tag = node.tagName;
    if (tag === "A") return node.hasAttribute("href");
    if (tag === "INPUT") return String(node.type || "").toLowerCase() !== "hidden" && !node.disabled;
    if (tag === "BUTTON" || tag === "SELECT" || tag === "TEXTAREA") return !node.disabled;
    if (tag === "SUMMARY" || tag === "LABEL") return true;
    if (node.isContentEditable) return true;
    if (node.hasAttribute("onclick") || node.hasAttribute("jsaction")) return true;
    const role = node.getAttribute("role");
    if (role && ACTIONABLE_ROLES.has(role.toLowerCase())) return true;
    const tabindex = node.getAttribute("tabindex");
    return tabindex != null && tabindex !== "-1";
  };

  const collect = (root, offsetX, offsetY, found) => {
    for (const node of root.querySelectorAll("*")) {
      if (node.shadowRoot) collect(node.shadowRoot, offsetX, offsetY, found);
      const rect = node.getBoundingClientRect();
      if (node.tagName === "IFRAME") {
        let doc = null;
        try {
          doc = node.contentDocument;
        } catch (error) {}
        if (doc && onScreen(rect, offsetX, offsetY)) {
          collect(doc, offsetX + rect.left, offsetY + rect.top, found);
        }
        continue;
      }
      if (!onScreen(rect, offsetX, offsetY)) continue;
      const style = getComputedStyle(node);
      if (style.visibility !== "visible" || Number(style.opacity) === 0) continue;
      const named = namedClickable(node);
      if (!named && style.cursor !== "pointer") continue;
      found.push({
        node,
        named,
        offsetX,
        offsetY,
        x: rect.left + offsetX,
        y: rect.top + offsetY,
        width: rect.width,
        height: rect.height,
      });
    }
  };

  /** pointer-styled wrappers and inner icons would otherwise each get a hint */
  const dropWrappers = (found) => {
    return found.filter((entry) => {
      if (entry.named) return true;
      for (const other of found) {
        if (other.node === entry.node) continue;
        if (entry.node.contains(other.node)) return false;
        if (other.named && other.node.contains(entry.node)) return false;
      }
      return true;
    });
  };

  const hintLabels = (count) => {
    const chars = HINT_CHARS.split("");
    const hints = [""];
    let offset = 0;
    while (hints.length - offset < count || hints.length === 1) {
      const prefix = hints[offset++];
      for (const char of chars) hints.push(prefix + char);
    }
    return hints
      .slice(offset, offset + count)
      .map((hint) => hint.split("").reverse().join(""))
      .sort();
  };

  const OVERLAY_CSS =
    ".hint{position:absolute;font:bold 11px ui-monospace,SFMono-Regular,Menlo,monospace;" +
    "line-height:1;letter-spacing:.5px;text-transform:uppercase;color:#302505;" +
    "background:linear-gradient(#fff785,#ffc542);border:1px solid #c38a22;border-radius:3px;" +
    "padding:2px 3px;box-shadow:0 1px 3px rgba(0,0,0,.35);white-space:nowrap}" +
    ".hint .typed{color:#b8641a}";

  let overlay = null;
  let hints = [];

  const openOverlay = () => {
    const host = document.createElement("div");
    host.setAttribute("data-terminal-browser-vim", "");
    host.style.cssText =
      "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = OVERLAY_CSS;
    shadow.appendChild(style);
    document.documentElement.appendChild(host);
    return { host, shadow };
  };

  const clearHints = () => {
    if (overlay) overlay.host.remove();
    overlay = null;
    hints = [];
    return true;
  };

  const paint = (typed) => {
    for (const hint of hints) {
      const hidden = !hint.label.startsWith(typed);
      hint.marker.style.display = hidden ? "none" : "block";
      if (hidden) continue;
      hint.marker.textContent = "";
      if (typed) {
        const done = document.createElement("span");
        done.className = "typed";
        done.textContent = typed;
        hint.marker.appendChild(done);
      }
      hint.marker.appendChild(document.createTextNode(hint.label.slice(typed.length)));
    }
  };

  const showHints = () => {
    clearHints();
    const found = [];
    collect(document, 0, 0, found);
    const targets = dropWrappers(found).sort((a, b) => a.y - b.y || a.x - b.x);
    if (targets.length === 0) return 0;
    overlay = openOverlay();
    const labels = hintLabels(targets.length);
    hints = targets.map((target, at) => {
      const marker = document.createElement("div");
      marker.className = "hint";
      marker.style.left = Math.max(0, Math.min(target.x, innerWidth - 24)) + "px";
      marker.style.top = Math.max(0, Math.min(target.y, innerHeight - 14)) + "px";
      overlay.shadow.appendChild(marker);
      return { label: labels[at], marker, target };
    });
    paint("");
    return hints.length;
  };

  const linkUrl = (node) => {
    const anchor = node.closest ? node.closest("a[href]") : null;
    if (!anchor) return null;
    const href = anchor.href;
    return href && !href.startsWith("javascript:") ? href : null;
  };

  const trustedPoint = (target) => {
    const rect = target.node.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
    const root = target.node.getRootNode();
    const picker = root.elementFromPoint ? root : target.node.ownerDocument;
    const hit = picker.elementFromPoint(x, y);
    if (!hit || (hit !== target.node && !target.node.contains(hit))) return null;
    return { x: x + target.offsetX, y: y + target.offsetY };
  };

  const syntheticClick = (node) => {
    const view = node.ownerDocument.defaultView;
    const options = { bubbles: true, cancelable: true, view, composed: true };
    node.dispatchEvent(new MouseEvent("mouseover", options));
    node.dispatchEvent(new MouseEvent("mousedown", options));
    if (node.focus) node.focus();
    node.dispatchEvent(new MouseEvent("mouseup", options));
    node.dispatchEvent(new MouseEvent("click", options));
  };

  const activate = (target, mode) => {
    const node = target.node;
    if (mode !== "click") {
      const url = linkUrl(node);
      if (url) return { kind: "url", url };
      if (mode === "copy") return { kind: "none" };
    }
    if (isEditable(node)) {
      node.focus();
      if (node.select) node.select();
      return { kind: "editable" };
    }
    const point = trustedPoint(target);
    if (point) return { kind: "point", x: point.x, y: point.y };
    syntheticClick(node);
    return { kind: "done" };
  };

  const typeHint = (typed, mode) => {
    const matches = hints.filter((hint) => hint.label.startsWith(typed));
    if (matches.length === 0) return { status: "miss" };
    if (matches.length > 1) {
      paint(typed);
      return { status: "typing", matches: matches.length };
    }
    const target = matches[0].target;
    clearHints();
    return { status: "activated", outcome: activate(target, mode) };
  };

  const focusInput = () => {
    const found = [];
    collect(document, 0, 0, found);
    const input = found.find((entry) => isEditable(entry.node));
    if (!input) return false;
    input.node.focus();
    if (input.node.select) input.node.select();
    return true;
  };

  let editableNow = false;
  const reportFocus = () => {
    const editable = isEditable(deepActive(document));
    if (editable === editableNow) return;
    editableNow = editable;
    emit({ type: "editable", editable });
  };
  document.addEventListener("focusin", reportFocus, true);
  document.addEventListener("focusout", () => setTimeout(reportFocus, 0), true);

  window.__terminalBrowserVim = {
    scroll,
    scrollEdge,
    showHints,
    typeHint,
    clearHints,
    focusInput,
    blur: () => {
      const node = deepActive(document);
      if (node && node.blur) node.blur();
      reportFocus();
      return true;
    },
    editable: () => isEditable(deepActive(document)),
    viewport: () => ({ width: innerWidth, height: innerHeight }),
  };
  reportFocus();
  return "ready";
})()`;
