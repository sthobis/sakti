// Scratch files in the Origin Private File System. A long video does not fit
// in memory, so segments and the finished MP4 are written to disk here, in a
// folder only Sakti can see, until chrome.downloads has copied the result out.

const FOLDER = "media";

async function folder(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(FOLDER, { create: true });
}

export async function createFile(name: string): Promise<FileSystemFileHandle> {
  return (await folder()).getFileHandle(name, { create: true });
}

/** Removes every scratch file whose name starts with `prefix`; all of them when it is empty. */
export async function removeFiles(prefix: string): Promise<void> {
  const directory = await folder();
  const names: string[] = [];
  for await (const name of directory.keys()) {
    if (name.startsWith(prefix)) names.push(name);
  }
  await Promise.all(names.map((name) => directory.removeEntry(name).catch(() => {})));
}
