import { describe, expect, it } from "vite-plus/test";

import { pendingLockKeys, withUserLock } from "./ping-lock.ts";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("withUserLock", () => {
  it("serializes work for the same key in call order", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const a = withUserLock("u1", async () => {
      order.push("a:start");
      await gate;
      order.push("a:end");
      return "a";
    });
    const b = withUserLock("u1", async () => {
      order.push("b:start");
      return "b";
    });
    await tick();
    // b must not start while a holds the lock.
    expect(order).toEqual(["a:start"]);
    release();
    expect(await a).toBe("a");
    expect(await b).toBe("b");
    expect(order).toEqual(["a:start", "a:end", "b:start"]);
  });

  it("runs different keys concurrently", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = withUserLock("u1", async () => {
      order.push("a:start");
      await gate;
    });
    const b = withUserLock("u2", async () => {
      order.push("b:start");
    });
    await tick();
    expect(order).toEqual(["a:start", "b:start"]);
    release();
    await Promise.all([a, b]);
  });

  it("a rejection reaches its caller and does not block the next call", async () => {
    const failing = withUserLock("u3", async () => {
      throw new Error("boom");
    });
    const next = withUserLock("u3", async () => "ok");
    await expect(failing).rejects.toThrow("boom");
    expect(await next).toBe("ok");
  });

  it("releases the key once the chain drains", async () => {
    await withUserLock("u4", async () => 1);
    await tick();
    expect(pendingLockKeys()).toBe(0);
  });
});
