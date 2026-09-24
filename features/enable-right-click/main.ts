// Enable Right Click. Runs in the page's MAIN world at document_start, before
// any page script, so pages only ever see what this file sets up.
//
// 1. Context menu. A capture-phase contextmenu listener on window, registered
//    before any page handler, stops the event from reaching the page's
//    listeners, so nothing can call preventDefault() and the native menu opens.
// 2. Popup guard. window.open() and scripted clicks on target="_blank" links
//    are allowed only within 2.5 s of a trusted click, tap or keypress on
//    something clickable. Click-hijack popups (a document-level listener that
//    opens a tab when you click plain page content) fail that test.

window.addEventListener("contextmenu", (event) => event.stopImmediatePropagation(), { capture: true });

const ACTIVATION_WINDOW_MS = 2500;
const INTERACTIVE =
  "a, button, input, select, textarea, summary, label, " +
  "audio[controls], video[controls], [contenteditable='true'], " +
  "[role='button'], [role='link'], [role='tab'], [role='menuitem'], [role='option']";
const NEW_TAB_TARGET = /^(_blank|_new)$/i;

let lastActivation = -Infinity;
let lastWasClickable = false;

function elementOf(target: EventTarget | null | undefined): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

// closest() that also crosses shadow-DOM boundaries
function parentAcrossShadow(node: Element): Element | null {
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function isClickable(target: EventTarget | null | undefined): boolean {
  const start = elementOf(target);
  if (!start) return false;
  try {
    // cursor inherits, so one check covers styled divs and custom elements
    if (getComputedStyle(start).cursor === "pointer") return true;
  } catch {
    // detached or cross-origin: fall through to the selector walk
  }
  for (let node: Element | null = start; node; node = parentAcrossShadow(node)) {
    if (node.matches(INTERACTIVE)) return true;
  }
  return false;
}

function record(event: Event): void {
  if (!event.isTrusted) return;
  if (event.type === "keydown") {
    const key = (event as KeyboardEvent).key;
    if (key !== "Enter" && key !== " ") return;
  }
  lastActivation = Date.now();
  lastWasClickable = isClickable(event.composedPath()[0] ?? event.target);
}
for (const type of ["pointerdown", "mousedown", "touchend", "click", "keydown"]) {
  window.addEventListener(type, record, { capture: true, passive: true });
}

const allowedNow = (): boolean => lastWasClickable && Date.now() - lastActivation < ACTIVATION_WINDOW_MS;

// ---- "Popup blocked" toast (top frame only; frames just log) ----

let toastHost: HTMLDivElement | null = null;
let toastLabel: HTMLDivElement | null = null;
let hideTimer = 0;
let blockedCount = 0;

function notify(url: string): void {
  console.info("[Sakti] Popup blocked:", url || "(blank)");
  if (window !== window.top || !document.documentElement) return;

  let source = "this page";
  try {
    source = new URL(url, location.href).hostname || source;
  } catch {
    // keep the default
  }
  blockedCount++;

  if (!toastHost || !toastLabel) {
    toastHost = document.createElement("div");
    toastHost.style.cssText = "all:initial; position:fixed; bottom:16px; right:16px; z-index:2147483647; pointer-events:none;";
    const shadow = toastHost.attachShadow({ mode: "closed" });
    toastLabel = document.createElement("div");
    toastLabel.style.cssText =
      "font:12px/1.4 system-ui,sans-serif; background:rgba(17,24,39,.92); color:#fff; " +
      "padding:8px 12px; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,.25); " +
      "transition:opacity .3s; opacity:1;";
    shadow.appendChild(toastLabel);
  }
  const host = toastHost;
  const label = toastLabel;
  label.textContent = `Popup blocked${blockedCount > 1 ? ` (${blockedCount}×)` : ""} — ${source}`;
  label.style.opacity = "1";
  if (!host.isConnected) (document.body ?? document.documentElement).appendChild(host);
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    label.style.opacity = "0";
    hideTimer = window.setTimeout(() => host.remove(), 350);
  }, 4000);
}

// ---- window.open ----

const nativeOpen = window.open;
window.open = function (this: Window, ...args: Parameters<typeof window.open>): WindowProxy | null {
  const [url, target] = args;
  const targetName = typeof target === "string" ? target.toLowerCase() : "";
  // _self/_parent/_top navigate an existing frame; that's not a popup
  if (targetName === "_self" || targetName === "_parent" || targetName === "_top" || allowedNow()) {
    return nativeOpen.apply(this, args);
  }
  notify(typeof url === "string" ? url : url instanceof URL ? url.href : "");
  return null;
};

// ---- element.click() on target="_blank" links (works even when detached) ----

const nativeClick = HTMLElement.prototype.click;
HTMLElement.prototype.click = function (this: HTMLElement): void {
  if (this.localName === "a" && NEW_TAB_TARGET.test(this.getAttribute("target") ?? "") && !allowedNow()) {
    notify(this.getAttribute("href") ?? "");
    return;
  }
  nativeClick.call(this);
};

// ---- dispatchEvent(new MouseEvent("click")) on target="_blank" links ----

window.addEventListener(
  "click",
  (event) => {
    if (event.isTrusted) return;
    const anchor = elementOf(event.composedPath()[0] ?? event.target)?.closest("a[target]");
    if (anchor && NEW_TAB_TARGET.test(anchor.getAttribute("target") ?? "") && !allowedNow()) {
      event.preventDefault();
      notify(anchor.getAttribute("href") ?? "");
    }
  },
  true,
);
