import { test } from "node:test";
import assert from "node:assert/strict";
import { createQueue } from "../src/core/queue.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test("queued tasks run one at a time, in order", async () => {
  const run = createQueue();
  const log: string[] = [];
  const task = (name: string) => async () => {
    log.push(`${name} start`);
    await tick();
    log.push(`${name} end`);
    return name;
  };
  const results = await Promise.all([run(task("a")), run(task("b"))]);
  assert.deepEqual(results, ["a", "b"]);
  assert.deepEqual(log, ["a start", "a end", "b start", "b end"]);
});

test("a failing task rejects its own caller and does not block the next one", async () => {
  const run = createQueue();
  const failed = run(async () => {
    throw new Error("boom");
  });
  const next = run(async () => "ok");
  await assert.rejects(failed, /boom/);
  assert.equal(await next, "ok");
});
