import { el } from "../../core/dom.ts";
import { requestReconcile, requestStatus } from "../../core/messages.ts";
import { readState, updateUserscript, writeUserscripts } from "../../core/storage.ts";
import { parseHeader, type UserscriptMeta } from "../../userscripts/header.ts";
import { applyDelete, applySave } from "../../userscripts/save.ts";
import { download } from "../common/download.ts";
import { toggle } from "../common/toggle.ts";
import { confirmLeave, setDirtyCheck } from "./guard.ts";
import type { Route } from "./route.ts";

export const NEW_SCRIPT = `// ==UserScript==
// @name        New script
// @match       https://example.com/*
// @grant       none
// ==/UserScript==

`;

// Shown once after the save that triggered a re-render.
let flash = "";

function metaItems(meta: UserscriptMeta): HTMLElement[] {
  const item = (label: string, value: string) => el("span", {}, [el("b", { text: `${label} ` }), value]);
  return [
    item("Name", meta.name),
    item("Runs on", meta.matches.join(", ")),
    ...(meta.excludeMatches.length ? [item("Except", meta.excludeMatches.join(", "))] : []),
    item("World", meta.world === "MAIN" ? "page (MAIN)" : "isolated (USER_SCRIPT)"),
    item("When", meta.runAt.replace("_", "-")),
  ];
}

export async function renderUserscripts(root: HTMLElement, route: Route): Promise<void> {
  const [{ userscripts, userscriptErrors }, status] = await Promise.all([readState(), requestStatus()]);
  const scripts = Object.values(userscripts).sort((a, b) => a.meta.name.localeCompare(b.meta.name));
  const selected = route.id ? (userscripts[route.id] ?? null) : null;

  let currentId: string | null = null;
  let savedSource = "";

  // ---- list ----
  const list = el(
    "ul",
    {},
    scripts.map((script) =>
      el("li", {}, [
        el("a", { href: `#userscripts/${script.id}`, class: script.enabled ? "" : "off", "aria-current": String(script.id === selected?.id), title: script.id }, [
          el("span", { class: "name", text: script.meta.name }),
          ...(userscriptErrors[script.id] ? [el("span", { class: "tag", text: "error" })] : []),
        ]),
      ]),
    ),
  );
  const newButton = el("button", { type: "button", id: "new-script", text: "New script" });
  const openButton = el("button", { type: "button", id: "open-file", text: "Open file…" });
  const fileInput = el("input", { type: "file", accept: ".js,text/javascript", hidden: "" });

  // ---- editor ----
  const meta = el("div", { class: "meta" });
  const messages = el("ul", { class: "messages" });
  const source = el("textarea", { id: "source", spellcheck: "false", autocomplete: "off", "aria-label": "Script source" });
  const saveButton = el("button", { type: "button", class: "primary", id: "save", text: "Save", title: "Save (Ctrl+S)" });
  const statusText = el("span", { class: "status", text: flash });
  flash = "";
  const downloadButton = el("button", { type: "button", id: "download-script", text: "Download" });
  const deleteButton = el("button", { type: "button", class: "danger", id: "delete", text: "Delete" });
  const enabledSwitch = selected
    ? toggle(selected.enabled, "Script on or off", async (on) => {
        await updateUserscript(selected.id, (record) => ({ ...record, enabled: on }));
        await requestReconcile();
      })
    : null;
  const editor = el("div", { class: "editor" }, [
    meta,
    messages,
    source,
    el("div", { class: "editor-actions" }, [
      saveButton,
      ...(enabledSwitch ? [enabledSwitch] : []),
      statusText,
      el("span", { class: "spacer" }),
      downloadButton,
      deleteButton,
    ]),
  ]);
  const empty = el("p", {
    class: "empty",
    text: scripts.length ? "Select a script, or create a new one." : "No userscripts yet. Create one, or open a .user.js file.",
  });

  function refresh(extraErrors: string[] = []): void {
    const parsed = parseHeader(source.value);
    meta.replaceChildren(...(parsed.meta ? metaItems(parsed.meta) : []));
    const runtimeError = currentId && source.value === savedSource ? userscriptErrors[currentId] : undefined;
    const errors = [...new Set([...extraErrors, ...parsed.errors, ...(runtimeError ? [`Chrome rejected this script: ${runtimeError}`] : [])])];
    messages.replaceChildren(
      ...errors.map((text) => el("li", { class: "error", text })),
      ...parsed.warnings.map((text) => el("li", { class: "warning", text })),
    );
  }

  function load(text: string, id: string | null): void {
    currentId = id;
    savedSource = text;
    source.value = text;
    editor.hidden = false;
    empty.hidden = true;
    deleteButton.hidden = id === null;
    // The switch belongs to the routed script; hide it while editing anything else.
    if (enabledSwitch) enabledSwitch.hidden = id === null || id !== selected?.id;
    refresh();
  }

  function markNone(): void {
    for (const link of list.querySelectorAll("a")) link.setAttribute("aria-current", "false");
  }

  async function save(): Promise<void> {
    const { userscripts: latest } = await readState();
    const result = applySave(latest, source.value, currentId, new Date().toISOString());
    if (!result.ok) {
      refresh(result.errors);
      statusText.textContent = "Not saved.";
      return;
    }
    await writeUserscripts(result.next);
    await requestReconcile();
    savedSource = source.value; // not dirty any more, so the router lets us move
    flash = "Saved.";
    const target = `#userscripts/${result.id}`;
    if (location.hash !== target) {
      location.hash = target; // the router re-renders this view
    } else {
      root.replaceChildren();
      await renderUserscripts(root, { tab: "userscripts", id: result.id });
    }
  }

  // ---- events ----
  newButton.addEventListener("click", () => {
    if (!confirmLeave()) return;
    markNone();
    load(NEW_SCRIPT, null);
    source.focus();
  });
  openButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file || !confirmLeave()) return;
    markNone();
    load(await file.text(), null);
  });
  source.addEventListener("input", () => refresh());
  source.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void save();
    } else if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      source.setRangeText("  ", source.selectionStart, source.selectionEnd, "end");
      refresh();
    }
  });
  saveButton.addEventListener("click", () => void save());
  downloadButton.addEventListener("click", () => {
    const name = (currentId ?? "script").replace(/\//g, "__");
    download(`${name}.user.js`, source.value, "text/javascript");
  });
  deleteButton.addEventListener("click", async () => {
    if (!currentId) return;
    const name = userscripts[currentId]?.meta.name ?? currentId;
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    const { userscripts: latest } = await readState();
    await writeUserscripts(applyDelete(latest, currentId));
    await requestReconcile();
    savedSource = source.value;
    location.hash = "#userscripts";
  });

  setDirtyCheck(() => !editor.hidden && source.value !== savedSource);

  if (selected) load(selected.source, selected.id);
  else editor.hidden = true;

  // ---- layout ----
  const notice = status.userScripts
    ? null
    : (() => {
        const details = el("button", { type: "button", text: "Open Sakti's details" });
        details.addEventListener("click", () => void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }));
        return el("div", { class: "notice" }, [
          el("p", {
            text: "Userscripts are saved but not running yet. Chrome runs them only after you allow it: on Sakti's details page, turn on Allow User Scripts (Chrome 138 and later), or turn on Developer mode (earlier versions).",
          }),
          details,
        ]);
      })();

  root.append(
    ...(notice ? [notice] : []),
    el("div", { class: "scripts" }, [
      el("aside", { class: "script-list" }, [el("div", { class: "list-actions" }, [newButton, openButton, fileInput]), list]),
      el("div", { class: "editor-col" }, [empty, editor]),
    ]),
  );
}
