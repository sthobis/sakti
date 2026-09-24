// Messages from extension pages to the service worker.

export type Message = { type: "sakti:reconcile" } | { type: "sakti:status" };

export interface StatusResponse {
  /** False until the user allows user scripts for Sakti in chrome://extensions. */
  userScripts: boolean;
}

/** Resolves once the worker has applied the current storage to Chrome. */
export async function requestReconcile(): Promise<void> {
  const message: Message = { type: "sakti:reconcile" };
  await chrome.runtime.sendMessage(message);
}

export async function requestStatus(): Promise<StatusResponse> {
  const message: Message = { type: "sakti:status" };
  return (await chrome.runtime.sendMessage(message)) as StatusResponse;
}
