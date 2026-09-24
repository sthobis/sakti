import { buildExport, mergeImport, parseImport, type ExportFile } from "../../core/backup.ts";
import { el } from "../../core/dom.ts";
import { requestReconcile } from "../../core/messages.ts";
import { readSnapshot, writeSnapshot } from "../../core/storage.ts";
import { download } from "../common/download.ts";
import type { Route } from "./route.ts";

interface BackupLog {
  exportedAt?: string;
  importedAt?: string;
}

const when = (iso: string | undefined): string => (iso ? new Date(iso).toLocaleString() : "never");

async function readLog(): Promise<BackupLog> {
  const { backupLog } = await chrome.storage.local.get("backupLog");
  return (backupLog ?? {}) as BackupLog;
}

async function writeLog(change: Partial<BackupLog>): Promise<void> {
  await chrome.storage.local.set({ backupLog: { ...(await readLog()), ...change } });
}

function describe(file: ExportFile): string {
  const features = Object.keys(file.features).length;
  const scripts = Object.keys(file.userscripts).length;
  const settings = Object.keys(file.settings.sync).length + Object.keys(file.settings.local).length;
  const from = file.exportedAt ? ` exported ${when(file.exportedAt)}` : "";
  return `This backup${from} has ${features} feature switches, ${scripts} userscripts and ${settings} feature settings.`;
}

export async function renderBackup(root: HTMLElement, _route: Route): Promise<void> {
  const log = await readLog();
  const status = el("p", { class: "status", id: "backup-message" });
  const exportButton = el("button", { type: "button", class: "primary", id: "export", text: "Export everything" });
  const importButton = el("button", { type: "button", id: "import", text: "Import from file…" });
  const fileInput = el("input", { type: "file", accept: ".json,application/json", hidden: "" });

  const rerender = async (message: string, isError = false) => {
    root.replaceChildren();
    await renderBackup(root, _route);
    const next = root.querySelector("#backup-message");
    if (next) {
      next.textContent = message;
      next.classList.toggle("error", isError);
    }
  };

  exportButton.addEventListener("click", async () => {
    const now = new Date().toISOString();
    const file = buildExport(await readSnapshot(), now);
    download(`sakti-backup-${now.slice(0, 10)}.json`, JSON.stringify(file, null, 2));
    await writeLog({ exportedAt: now });
    await rerender("Exported.");
  });

  importButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    const parsed = parseImport(await file.text());
    if (!parsed.ok) {
      status.textContent = parsed.error;
      status.classList.add("error");
      return;
    }
    const question = `${describe(parsed.file)}\n\nEntries with the same id will be replaced. Nothing here is deleted. Import?`;
    if (!confirm(question)) return;
    try {
      await writeSnapshot(mergeImport(await readSnapshot(), parsed.file));
      await requestReconcile();
      await writeLog({ importedAt: new Date().toISOString() });
      await rerender("Imported.");
    } catch (error) {
      try {
        await requestReconcile();
      } catch {
        // best effort: whatever was written should still take effect
      }
      const message = error instanceof Error ? error.message : String(error);
      await rerender(`Import failed: ${message}`, true);
    }
  });

  root.append(
    el("div", { class: "page" }, [
      el("section", { class: "card" }, [
        el("div", { class: "card-head" }, [el("h2", { text: "Backup" })]),
        el("p", {
          text: "One JSON file with every feature switch, feature setting and userscript. Use it to move your setup to another machine. Importing merges by id: entries in the file replace the same entries here, and nothing else is removed.",
        }),
        el("div", { class: "actions" }, [exportButton, importButton, fileInput]),
        el("p", { class: "status", text: `Last export: ${when(log.exportedAt)}. Last import: ${when(log.importedAt)}.` }),
        status,
      ]),
    ]),
  );
}
