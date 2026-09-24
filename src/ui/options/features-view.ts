import registry from "sakti:registry";
import type { RegistryEntry, SettingDef } from "../../core/feature.ts";
import { el } from "../../core/dom.ts";
import { requestReconcile } from "../../core/messages.ts";
import { settingsHandle } from "../../core/settings.ts";
import { featureState, type FeatureState } from "../../core/state.ts";
import { readState, updateFeature } from "../../core/storage.ts";
import { toggle } from "../common/toggle.ts";
import type { Route } from "./route.ts";

export async function renderFeatures(root: HTMLElement, route: Route, scroll = true): Promise<void> {
  const { features } = await readState();
  const rerender = async () => {
    root.replaceChildren();
    await renderFeatures(root, route, false);
  };
  const cards = await Promise.all(registry.map((entry) => card(entry, featureState(features, entry.id), route, rerender)));
  root.append(el("div", { class: "page" }, cards));
  if (scroll && route.id) document.getElementById(`feature-${route.id}`)?.scrollIntoView({ block: "center" });
}

async function card(entry: RegistryEntry, state: FeatureState, route: Route, rerender: () => Promise<void>): Promise<HTMLElement> {
  const enabled = toggle(state.enabled, `Turn ${entry.name} on or off`, async (on) => {
    await updateFeature(entry.id, (current) => ({ ...current, enabled: on }));
    await requestReconcile();
  });
  const node = el("section", { class: route.id === entry.id ? "card highlight" : "card", id: `feature-${entry.id}` }, [
    el("div", { class: "card-head" }, [el("h2", { text: entry.name }), enabled]),
    el("p", { text: entry.description }),
  ]);

  if (entry.perSite && state.disabledHosts.length) {
    const chips = state.disabledHosts.map((host) => {
      const remove = el("button", { type: "button", title: `Turn back on for ${host}`, "aria-label": `Turn back on for ${host}`, text: "×" });
      remove.addEventListener("click", async () => {
        await updateFeature(entry.id, (current) => ({ ...current, disabledHosts: current.disabledHosts.filter((h) => h !== host) }));
        await requestReconcile();
        await rerender();
      });
      return el("span", { class: "host" }, [host, remove]);
    });
    node.append(el("div", { class: "hosts" }, [el("h3", { text: "Turned off on" }), ...chips]));
  }

  const editable = Object.entries(entry.settings).filter(([, def]) => def.type !== "hidden");
  if (editable.length) {
    const handle = settingsHandle(entry.id, entry.settings);
    const rows = await Promise.all(
      editable.map(async ([name, def]) =>
        settingRow(`setting-${entry.id}-${name}`, def.label ?? name, def, await handle.get(name), (value) => handle.set(name, value)),
      ),
    );
    node.append(el("div", { class: "settings" }, [el("h3", { text: "Settings" }), ...rows]));
  }
  return node;
}

function settingRow(id: string, label: string, def: SettingDef, value: unknown, save: (value: unknown) => Promise<void>): HTMLElement {
  let input: HTMLInputElement | HTMLSelectElement;
  if (def.type === "boolean") {
    const checkbox = el("input", { type: "checkbox", id });
    checkbox.checked = Boolean(value);
    checkbox.addEventListener("change", () => void save(checkbox.checked));
    input = checkbox;
  } else if (def.type === "enum") {
    const select = el("select", { id }, (def.options ?? []).map((option) => el("option", { value: option, text: option })));
    select.value = String(value);
    select.addEventListener("change", () => void save(select.value));
    input = select;
  } else {
    const field = el("input", { type: def.type === "number" ? "number" : "text", id });
    field.value = value == null ? "" : String(value);
    field.addEventListener("change", () => void save(def.type === "number" ? Number(field.value) : field.value));
    input = field;
  }
  return el("div", { class: "setting" }, [input, el("label", { for: id, text: label })]);
}
