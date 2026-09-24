// Lets the userscript editor block navigation while it has unsaved changes.
// The router resets the check before rendering each view.

let dirtyCheck: () => boolean = () => false;

export function setDirtyCheck(check: () => boolean): void {
  dirtyCheck = check;
}

export function isDirty(): boolean {
  return dirtyCheck();
}

export function confirmLeave(): boolean {
  return !isDirty() || confirm("Discard unsaved changes?");
}
