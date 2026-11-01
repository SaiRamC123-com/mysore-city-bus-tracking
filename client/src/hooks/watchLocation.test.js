import assert from "node:assert/strict";
import { test } from "node:test";
import { watchLocation } from "./watchLocation.js";

function fakeGeolocation() {
  const watches = [];
  const cleared = [];
  return {
    watches,
    cleared,
    watchPosition(success, error, options) {
      watches.push({ success, error, options });
      return watches.length;
    },
    clearWatch(id) {
      cleared.push(id);
    },
  };
}

test("watchLocation forwards fixes and clears the active watch when stopped", () => {
  const geolocation = fakeGeolocation();
  const fixes = [];
  const stop = watchLocation(geolocation, { highAccuracy: true, onFix: (fix) => fixes.push(fix), onError: assert.fail });

  assert.equal(geolocation.watches.length, 1);
  assert.equal(geolocation.watches[0].options.enableHighAccuracy, true);
  geolocation.watches[0].success({
    coords: { latitude: 12.3, longitude: 76.6, accuracy: 15, speed: 2 },
    timestamp: 1234,
  });
  assert.deepEqual(fixes, [{ lat: 12.3, lng: 76.6, accuracy: 15, speed: 2, ts: 1234 }]);

  stop();
  geolocation.watches[0].success({ coords: { latitude: 12.4, longitude: 76.7 }, timestamp: 2345 });
  assert.deepEqual(geolocation.cleared, [1]);
  assert.equal(fixes.length, 1);
});

test("watchLocation retries low accuracy after GPS failure and reports permission denial", () => {
  const geolocation = fakeGeolocation();
  const errors = [];
  watchLocation(geolocation, { highAccuracy: true, onFix: assert.fail, onError: (message) => errors.push(message) });

  geolocation.watches[0].error({ code: 2 });
  assert.deepEqual(geolocation.cleared, [1]);
  assert.equal(geolocation.watches.length, 2);
  assert.equal(geolocation.watches[1].options.enableHighAccuracy, false);

  geolocation.watches[1].error({ code: 1 });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /permission was denied/i);
});
