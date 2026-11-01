// The browser-location logic, kept apart from React so it can be tested with a fake `geolocation`.

/** Plain-language reason for a browser location error code (1 denied, 2 unavailable, 3 timeout). */
export function locationMessage(code) {
  if (code === 1) return "Location permission was denied. Click the lock icon next to the web address, set Location to Allow, then try again.";
  if (code === 3) return "Finding your location took too long. Try again, or move near a window.";
  return "This device can't work out where it is. On Windows, turn on Settings > Privacy & security > Location. A phone usually works much better than a laptop.";
}

/**
 * Start watching the device location. Returns a function that stops watching.
 * A laptop has no GPS chip, so when the high-accuracy request fails (but permission is fine)
 * it quietly retries once with the normal Wi-Fi based location before giving up.
 */
export function watchLocation(geolocation, { highAccuracy = false, onFix, onError }) {
  let id = null;
  let stopped = false;

  const begin = (high) => {
    id = geolocation.watchPosition(
      (p) => {
        if (!stopped)
          onFix({
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            accuracy: p.coords.accuracy,
            speed: p.coords.speed,
            ts: p.timestamp,
          });
      },
      (e) => {
        if (stopped) return;
        geolocation.clearWatch(id);
        if (e.code !== 1 && high) return begin(false);
        stopped = true;
        onError(locationMessage(e.code));
      },
      { enableHighAccuracy: high, maximumAge: 2000, timeout: 15000 }
    );
  };

  begin(highAccuracy);
  return () => {
    stopped = true;
    if (id != null) geolocation.clearWatch(id);
  };
}