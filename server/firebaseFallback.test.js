import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const serverDir = fileURLToPath(new URL(".", import.meta.url));

test("missing Firebase credentials do not expose practice seed routes to production APIs", () => {
  const script = `
    const firebase = await import("./src/config/firebase.js");
    const { getStatic, getPracticeStatic } = await import("./src/services/dataService.js");
    const data = await getStatic();
    const practice = await getPracticeStatic();
    console.log(JSON.stringify({
      usingMemory: firebase.usingMemory,
      firebaseConfigured: firebase.firebaseConfigured,
      memoryFallback: firebase.memoryFallback,
      routeCount: data.routeList.length,
      stopCount: Object.keys(data.stops).length,
      practiceRouteCount: practice.routeList.length,
      practiceStopCount: Object.keys(practice.stops).length,
      practiceRoutesAreDemo: practice.routeList.every((route) => route.demo),
    }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: serverDir,
    encoding: "utf8",
    env: {
      ...process.env,
      USE_MEMORY_DB: "false",
      FIREBASE_SERVICE_ACCOUNT_JSON: "",
      FIREBASE_DATABASE_URL: "",
      GOOGLE_APPLICATION_CREDENTIALS: "./missing-test-service-account.json",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(status.usingMemory, true);
  assert.equal(status.firebaseConfigured, false);
  assert.equal(status.memoryFallback, true);
  assert.equal(status.routeCount, 0);
  assert.equal(status.stopCount, 0);
  assert.ok(status.practiceRouteCount > 0);
  assert.ok(status.practiceStopCount > 0);
  assert.equal(status.practiceRoutesAreDemo, true);
});
