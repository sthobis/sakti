// Small element builder shared by features and extension pages.

type Attrs = Record<string, string | Record<string, string>>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value !== "string") {
      if (key === "dataset") Object.assign(node.dataset, value);
      continue;
    }
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}
