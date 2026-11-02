import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const serverDir = fileURLToPath(new URL(".", import.meta.url));

test("missing Firebase production credentials use bundled data without crashing the API", () => {
  const script = `
    const firebase = await import("./src/config/firebase.js");
    const { getStatic } = await import("./src/services/dataService.js");
    const data = await getStatic();
    console.log(JSON.stringify({
      usingMemory: firebase.usingMemory,
      firebaseConfigured: firebase.firebaseConfigured,
      memoryFallback: firebase.memoryFallback,
      routeCount: data.routeList.length,
      stopCount: Object.keys(data.stops).length,
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
  assert.ok(status.routeCount > 0);
  assert.ok(status.stopCount > 0);
});
