// The popup answers one question: what is Sakti doing on this page, and can
// I switch it off here?

import "./popup.css";
import registry from "sakti:registry";
import { el } from "../../core/dom.ts";
import { hostOf, urlMatches } from "../../core/match.ts";
import { requestReconcile } from "../../core/messages.ts";
import { featureState, toggleHost } from "../../core/state.ts";
import { readState, updateFeature, updateUserscript } from "../../core/storage.ts";
import { toggle } from "../common/toggle.ts";

interface Row {
  kind: "feature" | "userscript";
  id: string;
  name: string;
  enabled: boolean;
  perSite: boolean;
  matchesHere: boolean;
  disabledHere: boolean;
}

let tab: chrome.tabs.Tab | undefined;

async function rows(): Promise<Row[]> {
  const url = tab?.url ?? "";
  const host = hostOf(url);
  const { features, userscripts } = await readState();

  const list: Row[] = registry.map((entry): Row => {
    const state = featureState(features, entry.id);
    return {
      kind: "feature",
      id: entry.id,
      name: entry.name,
      enabled: state.enabled,
      perSite: entry.perSite,
      matchesHere: urlMatches(entry.matches, entry.excludeMatches, url),
      disabledHere: host !== null && state.disabledHosts.includes(host),
    };
  });

  const scripts = Object.values(userscripts).sort((a, b) => a.meta.name.localeCompare(b.meta.name));
  for (const script of scripts) {
    list.push({
      kind: "userscript",
      id: script.id,
      name: script.meta.name,
      enabled: script.enabled,
      perSite: true,
      matchesHere: urlMatches(script.meta.matches, script.meta.excludeMatches, url),
      disabledHere: host !== null && script.disabledHosts.includes(host),
    });
  }
  return list;
}

async function render(): Promise<void> {
  const host = hostOf(tab?.url);
  document.getElementById("host")!.textContent = host ?? "Sakti features don't run on this page.";

  const all = await rows();
  const here = host ? all.filter((row) => row.matchesHere) : [];
  const elsewhere = all.filter((row) => !here.includes(row));
  fill("here", here, host);
  fill("elsewhere", elsewhere, null);
  document.getElementById("here")!.hidden = here.length === 0;
}

function fill(sectionId: string, list: Row[], host: string | null): void {
  const ul = document.querySelector(`#${sectionId} ul`)!;
  ul.replaceChildren(...list.map((row) => renderRow(row, host)));
  if (list.length === 0) ul.append(el("li", { class: "empty", text: "Nothing here." }));
}

function renderRow(row: Row, host: string | null): HTMLLIElement {
  const children: Node[] = [el("span", { class: "name", title: row.name, text: row.name })];
  if (row.kind === "userscript") children.push(el("span", { class: "tag", text: "script" }));

  const edit = el("a", { class: "edit", href: "#", text: "edit" });
  edit.addEventListener("click", (event) => {
    event.preventDefault();
    openOptions(row);
  });
  children.push(edit);

  if (host && row.perSite) {
    const site = toggle(!row.disabledHere, `Run on ${host}`, (on) => void setSite(row, host, on));
    children.push(el("span", { class: "site" }, [site, "site"]));
  }
  children.push(toggle(row.enabled, "On everywhere", (on) => void setGlobal(row, on)));
  return el("li", {}, children);
}

async function setGlobal(row: Row, on: boolean): Promise<void> {
  if (row.kind === "feature") await updateFeature(row.id, (state) => ({ ...state, enabled: on }));
  else await updateUserscript(row.id, (record) => ({ ...record, enabled: on }));
  await requestReconcile();
  await render();
}

async function setSite(row: Row, host: string, on: boolean): Promise<void> {
  if (row.kind === "feature") {
    await updateFeature(row.id, (state) => ({ ...state, disabledHosts: toggleHost(state.disabledHosts, host, !on) }));
  } else {
    await updateUserscript(row.id, (record) => ({ ...record, disabledHosts: toggleHost(record.disabledHosts, host, !on) }));
  }
  await requestReconcile(); // registrations must be updated before the page reloads
  if (tab?.id !== undefined) await chrome.tabs.reload(tab.id);
  await render();
}

function openOptions(row: Row): void {
  const hash = row.kind === "feature" ? `features/${row.id}` : `userscripts/${row.id}`;
  void chrome.tabs.create({ url: chrome.runtime.getURL(`options.html#${hash}`) });
}

async function main(): Promise<void> {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  document.getElementById("version")!.textContent = `v${chrome.runtime.getManifest().version}`;
  document.getElementById("open-options")!.addEventListener("click", () => void chrome.runtime.openOptionsPage());
  await render();
}

void main();
