// Runs async tasks one at a time, in call order. Storage updates are
// read-modify-write on shared values; running them through a queue keeps two
// quick changes from the same page from overwriting each other.

export type Queue = <T>(task: () => Promise<T>) => Promise<T>;

export function createQueue(): Queue {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  };
}
