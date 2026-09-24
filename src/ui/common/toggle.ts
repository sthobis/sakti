import { el } from "../../core/dom.ts";

export function toggle(checked: boolean, label: string, onChange: (checked: boolean) => void): HTMLLabelElement {
  const input = el("input", { type: "checkbox", "aria-label": label });
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  return el("label", { class: "switch", title: label }, [input, el("span", { class: "switch-track" })]);
}
