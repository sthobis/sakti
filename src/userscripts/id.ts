// Userscript ids are derived from the header, so the same script gets the same
// id on every machine and backups stay readable.

export function slug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function scriptId(name: string, namespace?: string): string {
  const ns = namespace ? slug(namespace) : "";
  const base = slug(name);
  return ns ? `${ns}/${base}` : base;
}
