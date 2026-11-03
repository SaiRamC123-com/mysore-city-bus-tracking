import { timingSafeEqual } from "node:crypto";
import express, { Router } from "express";
import { env } from "../config/env.js";
import { getStatic, invalidateStaticCache } from "../services/dataService.js";
import { publishGtfsFeed } from "../services/gtfsFeedService.js";
import { readGtfsZip } from "../services/gtfsImport.js";
import { ah, HttpError } from "../utils/http.js";

const r = Router();

r.get("/gtfs/status", ah(async (_req, res) => {
  const { routeList, stops, metadata } = await getStatic();
  res.json({
    available: Boolean(metadata?.feedId),
    source: metadata?.source ?? null,
    sourceLabel: metadata?.sourceLabel ?? "No imported GTFS feed",
    verified: metadata?.verified ?? false,
    importedAt: metadata?.importedAt ?? null,
    routeCount: routeList.length,
    stopCount: Object.keys(stops).length,
    tripCount: metadata?.tripCount ?? 0,
    serviceCalendarAvailable: metadata?.serviceCalendarAvailable ?? false,
    timezone: metadata?.timezone ?? null,
    timezoneSource: metadata?.timezoneSource ?? null,
  });
}));

r.post(
  "/admin/gtfs/import",
  (req, _res, next) => {
    if (!env.gtfsImportSecret) return next(new HttpError(503, "GTFS import is disabled (GTFS_IMPORT_SECRET is not configured)."));
    const supplied = Buffer.from(String(req.get("x-gtfs-import-secret") ?? ""));
    const expected = Buffer.from(env.gtfsImportSecret);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return next(new HttpError(401, "A valid GTFS import secret is required."));
    }
    next();
  },
  (req, _res, next) => {
    if (!["application/zip", "application/octet-stream"].includes(req.get("content-type")?.split(";")[0])) {
      return next(new HttpError(415, "Send the GTFS ZIP as application/zip."));
    }
    next();
  },
  express.raw({ type: ["application/zip", "application/octet-stream"], limit: "4mb" }),
  ah(async (req, res) => {
    let feed;
    try {
      feed = await readGtfsZip(req.body);
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    const published = await publishGtfsFeed(feed);
    invalidateStaticCache();
    res.status(201).json({
      message: "GTFS feed imported and activated. Its routes remain unverified until checked against an authoritative source.",
      ...published,
    });
  })
);

export default r;
