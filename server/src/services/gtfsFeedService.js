import { createHash } from "node:crypto";
import { db, usingMemory } from "../config/firebase.js";
import { HttpError } from "../utils/http.js";

const serviceDocId = (id) => createHash("sha256").update(id).digest("hex").slice(0, 32);

async function writeDocuments(collection, rows, idOf) {
  for (let offset = 0; offset < rows.length; offset += 400) {
    const batch = db.batch();
    for (const row of rows.slice(offset, offset + 400)) {
      const { id, ...data } = row;
      batch.set(collection.doc(idOf(row)), data);
    }
    await batch.commit();
  }
}

export async function publishGtfsFeed(feed) {
  if (!db || usingMemory) {
    throw new HttpError(503, "GTFS import requires persistent Firebase Firestore. Configure Firebase credentials before importing.");
  }
  const feedRef = db.collection("gtfs_feeds").doc(feed.feedId);
  const collection = (name) => feedRef.collection(name);
  const services = Object.entries(feed.services).map(([serviceId, data]) => ({ id: serviceId, serviceId, ...data }));

  await Promise.all([
    writeDocuments(collection("routes"), feed.routes, (row) => row.id),
    writeDocuments(collection("stops"), feed.stops, (row) => row.id),
    writeDocuments(collection("trips"), feed.trips, (row) => createHash("sha256").update(row.id).digest("hex").slice(0, 32)),
    writeDocuments(collection("services"), services, (row) => serviceDocId(row.id)),
  ]);

  const manifest = {
    source: feed.source,
    sourceLabel: feed.sourceLabel,
    verified: false,
    importedAt: feed.importedAt,
    routeCount: feed.routeCount,
    stopCount: feed.stopCount,
    tripCount: feed.tripCount,
    serviceCalendarAvailable: feed.serviceCalendarAvailable,
    timezone: feed.timezone,
    timezoneSource: feed.timezoneSource,
    status: "ready",
  };
  await feedRef.set(manifest);
  await db.collection("gtfs").doc("active").set({
    feedId: feed.feedId,
    activatedAt: new Date().toISOString(),
    ...manifest,
  });
  return { feedId: feed.feedId, ...manifest };
}
