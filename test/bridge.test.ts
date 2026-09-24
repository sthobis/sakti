import { test } from "node:test";
import assert from "node:assert/strict";
import { createChannel } from "../src/core/bridge.ts";

type Ping = { n: number };
type Pong = { ok: boolean };

test("messages cross between the isolated and main sides, and a side does not hear itself", () => {
  const target = new EventTarget();
  const isolated = createChannel<Ping, Pong>("demo", "isolated", target);
  const main = createChannel<Pong, Ping>("demo", "main", target);
  const heardByMain: Ping[] = [];
  const heardByIsolated: Pong[] = [];
  main.onMessage((m) => heardByMain.push(m));
  isolated.onMessage((m) => heardByIsolated.push(m));

  isolated.send({ n: 1 });
  main.send({ ok: true });

  assert.deepEqual(heardByMain, [{ n: 1 }]);
  assert.deepEqual(heardByIsolated, [{ ok: true }]);
});

test("unsubscribing stops delivery", () => {
  const target = new EventTarget();
  const isolated = createChannel<Ping, Pong>("demo", "isolated", target);
  const main = createChannel<Pong, Ping>("demo", "main", target);
  const heard: Ping[] = [];
  const stop = main.onMessage((m) => heard.push(m));
  stop();
  isolated.send({ n: 1 });
  assert.deepEqual(heard, []);
});

test("channels with different names do not hear each other", () => {
  const target = new EventTarget();
  const heard: Ping[] = [];
  createChannel<Pong, Ping>("one", "main", target).onMessage((m) => heard.push(m));
  createChannel<Ping, Pong>("two", "isolated", target).send({ n: 1 });
  assert.deepEqual(heard, []);
});

test("payloads that are not JSON strings are ignored", () => {
  const target = new EventTarget();
  const heard: Ping[] = [];
  createChannel<Pong, Ping>("demo", "main", target).onMessage((m) => heard.push(m));
  target.dispatchEvent(new CustomEvent("sakti:demo:to-main", { detail: "{not json" }));
  target.dispatchEvent(new CustomEvent("sakti:demo:to-main", { detail: { n: 1 } }));
  assert.deepEqual(heard, []);
});
