import test from "node:test";
import assert from "node:assert/strict";
import { LiveEnglishCoachController, parseLiveCoachAdvice } from "../src/liveCoach.js";

function deferred() {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return { promise, resolve };
}

test("Help now starts an immediate capture while an automatic analysis is running", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    setInterval: () => 1,
    clearInterval: () => {}
  };

  const automaticReply = deferred();
  const immediateReply = deferred();
  const calls = [];
  const controller = new LiveEnglishCoachController({
    getOutputMode: () => "translation",
    invoke: (command, args) => {
      calls.push({ command, args });
      if (command === "ai_audio_capture_start") return Promise.resolve();
      if (args.immediate) return immediateReply.promise;
      if (!args.stop) return automaticReply.promise;
      return Promise.resolve(null);
    }
  });

  try {
    await controller.start();
    const automatic = controller.flushNow();
    await Promise.resolve();
    const immediate = controller.flushNow({ immediate: true });
    await Promise.resolve();

    const flushCalls = calls.filter(call => call.command === "ai_live_coach_flush_and_advise");
    automaticReply.resolve(null);
    immediateReply.resolve(null);
    await Promise.all([automatic, immediate]);
    assert.equal(flushCalls.length, 2);
    assert.equal(flushCalls.find(call => call.args?.immediate)?.args.immediate, true);
    assert.equal(flushCalls[0].args.outputMode, "translation");
    await controller.stop();
  } finally {
    controller.active = false;
    globalThis.window = previousWindow;
  }
});

test("live translation polls audio every 2.5 seconds by default", async () => {
  const previousWindow = globalThis.window;
  let intervalMs;
  globalThis.window = {
    setInterval: (_callback, delay) => {
      intervalMs = delay;
      return 1;
    },
    clearInterval: () => {}
  };
  const controller = new LiveEnglishCoachController({
    invoke: command => command === "ai_audio_capture_start" ? Promise.resolve() : Promise.resolve(null)
  });

  try {
    await controller.start();
    assert.equal(intervalMs, 2500);
    await controller.stop();
  } finally {
    controller.active = false;
    globalThis.window = previousWindow;
  }
});

test("parseLiveCoachAdvice accepts translation-only responses", () => {
  const advice = parseLiveCoachAdvice(JSON.stringify({
    skip: false,
    translation: "A reunião foi adiada para amanhã.",
    suggestions: []
  }));
  assert.equal(advice.translation, "A reunião foi adiada para amanhã.");
  assert.deepEqual(advice.suggestions, []);
});
