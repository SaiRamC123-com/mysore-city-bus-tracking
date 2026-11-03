import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import "dotenv/config";
import { publishGtfsFeed } from "../src/services/gtfsFeedService.js";
import { readGtfsZip } from "../src/services/gtfsImport.js";

const archivePath = process.argv[2];
if (!archivePath) throw new Error("Usage: npm run import:gtfs -- <authorized-gtfs-feed.zip>");
const path = resolve(archivePath);
const size = statSync(path).size;
if (size > 4 * 1024 * 1024) throw new Error("GTFS ZIP exceeds the 4 MB import limit.");
const feed = await readGtfsZip(readFileSync(path));
const published = await publishGtfsFeed(feed);
console.log(JSON.stringify(published, null, 2));
