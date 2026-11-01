import { useCallback, useEffect, useRef, useState } from "react";
import { watchLocation } from "./watchLocation.js";

/**
 * Browser location. Nothing is requested until request() is called (so the permission prompt
 * appears after a tap, not on page load). Returns { pos, error, watching, request, stop }.
 * pos = { lat, lng, accuracy, speed (m/s or null), ts }
 */
export function useGeolocation({ highAccuracy = false } = {}) {
  const [pos, setPos] = useState(null);
  const [error, setError] = useState("");
  const [watching, setWatching] = useState(false);
  const stopWatching = useRef(null);

  const stop = useCallback(() => {
    stopWatching.current?.();
    stopWatching.current = null;
    setPos(null);
    setWatching(false);
  }, []);

  const request = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError("This browser can't share its location.");
      return false;
    }
    if (stopWatching.current) return true;
    setError("");
    setPos(null);
    setWatching(true);
    try {
      stopWatching.current = watchLocation(navigator.geolocation, {
        highAccuracy,
        onFix: setPos,
        onError: (message) => {
          setError(message);
          stop();
        },
      });
      return true;
    } catch (error) {
      setWatching(false);
      setError(error?.message || "This browser couldn't start location sharing.");
      return false;
    }
  }, [highAccuracy, stop]);

  useEffect(() => () => stop(), [stop]);

  return { pos, error, watching, request, stop };
}