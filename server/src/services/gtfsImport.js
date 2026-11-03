import { createHash, randomUUID } from "node:crypto";
import yauzl from "yauzl";

const REQUIRED_FILES = ["routes.txt", "stops.txt", "trips.txt", "stop_times.txt"];
const MAX_ZIP_BYTES = 4 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_ROWS = 150_000;
const MAX_STOPS_PER_TRIP = 2_000;
const MAX_POINTS_PER_SHAPE = 10_000;

function csvRows(text, fileName) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  let afterQuote = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
        afterQuote = true;
      } else {
        value += ch;
      }
    } else if (afterQuote && ch !== "\n" && ch !== "\r" && ch.trim() === "") {
      continue;
    } else if (afterQuote && ch !== "," && ch !== "\n" && ch !== "\r") {
      throw new Error(`${fileName}: unexpected character after a quoted field.`);
    } else if (ch === '"' && value === "" && !afterQuote) {
      quoted = true;
    } else if (ch === '"') {
      throw new Error(`${fileName}: quote inside an unquoted field.`);
    } else if (ch === ",") {
      row.push(value);
      value = "";
      afterQuote = false;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(value);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      value = "";
      afterQuote = false;
    } else {
      value += ch;
    }
  }
  if (quoted) throw new Error(`${fileName}: unterminated quoted field.`);
  row.push(value);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  if (!rows.length) throw new Error(`${fileName}: file is empty.`);

  const headers = rows.shift().map((header) => header.trim());
  if (headers.some((header) => !header) || new Set(headers).size !== headers.length) {
    throw new Error(`${fileName}: headers must be non-empty and unique.`);
  }
  const records = rows.map((cells, index) => {
    if (cells.length !== headers.length) {
      throw new Error(`${fileName}: row ${index + 2} has ${cells.length} columns; expected ${headers.length}.`);
    }
    return Object.fromEntries(headers.map((header, column) => [header, cells[column].trim()]));
  });
  if (records.length > MAX_ROWS) throw new Error(`${fileName}: exceeds the ${MAX_ROWS.toLocaleString()} row limit.`);
  return { headers: new Set(headers), records };
}

function requireColumns(fileName, data, columns) {
  const missing = columns.filter((column) => !data.headers.has(column));
  if (missing.length) throw new Error(`${fileName}: missing required columns: ${missing.join(", ")}.`);
}

function uniqueIndex(rows, field, fileName) {
  const map = new Map();
  for (const [index, row] of rows.entries()) {
    const value = row[field];
    if (!value) throw new Error(`${fileName}: row ${index + 2} has an empty ${field}.`);
    if (map.has(value)) throw new Error(`${fileName}: duplicate ${field} "${value}".`);
    map.set(value, row);
  }
  return map;
}

function coordinate(value, field, rowNumber, fileName) {
  if (!String(value ?? "").trim()) throw new Error(`${fileName}: row ${rowNumber} has an empty ${field}.`);
  const parsed = Number(value);
  const min = field.endsWith("lat") ? -90 : -180;
  const max = field.endsWith("lat") ? 90 : 180;
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${fileName}: row ${rowNumber} has an invalid ${field}.`);
  }
  return parsed;
}

function parseGtfsTime(value, fileName, rowNumber, field) {
  const match = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(value);
  if (!match) throw new Error(`${fileName}: row ${rowNumber} has an invalid ${field} (expected H:MM:SS).`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function validDate(value) {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  if (year < 100) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function stableId(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function parseServiceDates(calendarFiles, trips) {
  const services = new Map();
  if (calendarFiles.calendar) {
    const parsed = csvRows(calendarFiles.calendar, "calendar.txt");
    const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    requireColumns("calendar.txt", parsed, ["service_id", ...weekdays, "start_date", "end_date"]);
    if (!parsed.records.length) throw new Error("calendar.txt contains no service records.");
    for (const [index, row] of parsed.records.entries()) {
      if (services.has(row.service_id)) throw new Error(`calendar.txt: duplicate service_id "${row.service_id}".`);
      if (!validDate(row.start_date) || !validDate(row.end_date) || row.start_date > row.end_date) {
        throw new Error(`calendar.txt: row ${index + 2} has an invalid date range.`);
      }
      if (weekdays.some((day) => !["0", "1"].includes(row[day]))) {
        throw new Error(`calendar.txt: row ${index + 2} weekday flags must be 0 or 1.`);
      }
      services.set(row.service_id, { weekdays: weekdays.map((day) => row[day] === "1"), startDate: row.start_date, endDate: row.end_date, exceptions: {} });
    }
  }
  if (calendarFiles.calendar_dates) {
    const parsed = csvRows(calendarFiles.calendar_dates, "calendar_dates.txt");
    requireColumns("calendar_dates.txt", parsed, ["service_id", "date", "exception_type"]);
    for (const [index, row] of parsed.records.entries()) {
      if (!validDate(row.date) || !["1", "2"].includes(row.exception_type)) {
        throw new Error(`calendar_dates.txt: row ${index + 2} has an invalid date or exception_type.`);
      }
      const service = services.get(row.service_id) ?? { weekdays: null, startDate: null, endDate: null, exceptions: {} };
      if (Object.hasOwn(service.exceptions, row.date)) {
        throw new Error(`calendar_dates.txt: duplicate exception for service_id "${row.service_id}" on ${row.date}.`);
      }
      service.exceptions[row.date] = row.exception_type === "1";
      services.set(row.service_id, service);
    }
  }
  for (const trip of trips) {
    if (!trip.service_id) throw new Error(`trips.txt: trip "${trip.trip_id}" has no service_id.`);
    if (services.size && !services.has(trip.service_id)) {
      throw new Error(`trips.txt: trip "${trip.trip_id}" references unknown service_id "${trip.service_id}".`);
    }
  }
  return services;
}

export function parseGtfsFiles(files) {
  for (const file of REQUIRED_FILES) {
    if (!files[file]) throw new Error(`GTFS archive is missing required ${file}.`);
  }

  const routesFile = csvRows(files["routes.txt"], "routes.txt");
  const stopsFile = csvRows(files["stops.txt"], "stops.txt");
  const tripsFile = csvRows(files["trips.txt"], "trips.txt");
  const stopTimesFile = csvRows(files["stop_times.txt"], "stop_times.txt");
  requireColumns("routes.txt", routesFile, ["route_id", "route_type"]);
  if (!routesFile.headers.has("route_short_name") && !routesFile.headers.has("route_long_name")) {
    throw new Error("routes.txt: requires route_short_name or route_long_name.");
  }
  requireColumns("stops.txt", stopsFile, ["stop_id", "stop_name", "stop_lat", "stop_lon"]);
  requireColumns("trips.txt", tripsFile, ["route_id", "service_id", "trip_id"]);
  requireColumns("stop_times.txt", stopTimesFile, ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"]);

  const routeIndex = uniqueIndex(routesFile.records, "route_id", "routes.txt");
  const stopIndex = uniqueIndex(stopsFile.records, "stop_id", "stops.txt");
  const tripIndex = uniqueIndex(tripsFile.records, "trip_id", "trips.txt");
  for (const [index, route] of routesFile.records.entries()) {
    if (!(route.route_short_name || route.route_long_name) || (route.route_long_name?.length ?? 0) > 250) {
      throw new Error(`routes.txt: row ${index + 2} has an invalid route name.`);
    }
    if (!route.route_type || !Number.isSafeInteger(Number(route.route_type)) || Number(route.route_type) < 0) {
      throw new Error(`routes.txt: row ${index + 2} has an invalid route_type.`);
    }
  }
  const stopIds = new Map([...stopIndex.keys()].map((id) => [id, `gtfs-stop-${stableId(id)}`]));
  const stops = [...stopIndex.values()].map((row, index) => {
    const id = stopIds.get(row.stop_id);
    const name = row.stop_name.trim();
    if (!name || name.length > 200) throw new Error(`stops.txt: row ${index + 2} has an invalid stop_name.`);
    return {
      id,
      gtfsStopId: row.stop_id,
      name,
      nameKn: row.stop_name,
      lat: coordinate(row.stop_lat, "stop_lat", index + 2, "stops.txt"),
      lng: coordinate(row.stop_lon, "stop_lon", index + 2, "stops.txt"),
      radiusM: 40,
      verified: false,
      source: "gtfs-upload",
    };
  });
  const stopsById = new Map(stops.map((stop) => [stop.id, stop]));

  for (const [index, trip] of tripsFile.records.entries()) {
    if (!routeIndex.has(trip.route_id)) throw new Error(`trips.txt: row ${index + 2} references unknown route_id "${trip.route_id}".`);
    if (trip.direction_id && !["0", "1"].includes(trip.direction_id)) {
      throw new Error(`trips.txt: row ${index + 2} has an invalid direction_id.`);
    }
  }
  const routesWithTrips = new Set(tripsFile.records.map((trip) => trip.route_id));
  const unusedRoute = [...routeIndex.keys()].find((routeId) => !routesWithTrips.has(routeId));
  if (unusedRoute) throw new Error(`routes.txt: route "${unusedRoute}" is not referenced by any trip.`);

  const stopTimesByTrip = new Map([...tripIndex.keys()].map((id) => [id, []]));
  for (const [index, row] of stopTimesFile.records.entries()) {
    const trip = tripIndex.get(row.trip_id);
    if (!trip) throw new Error(`stop_times.txt: row ${index + 2} references unknown trip_id "${row.trip_id}".`);
    if (!stopIndex.has(row.stop_id)) throw new Error(`stop_times.txt: row ${index + 2} references unknown stop_id "${row.stop_id}".`);
    const sequence = row.stop_sequence ? Number(row.stop_sequence) : NaN;
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error(`stop_times.txt: row ${index + 2} has an invalid stop_sequence.`);
    const arrivalSeconds = parseGtfsTime(row.arrival_time, "stop_times.txt", index + 2, "arrival_time");
    const departureSeconds = parseGtfsTime(row.departure_time, "stop_times.txt", index + 2, "departure_time");
    if (departureSeconds < arrivalSeconds) throw new Error(`stop_times.txt: row ${index + 2} departs before it arrives.`);
    stopTimesByTrip.get(row.trip_id).push({ stopId: row.stop_id, sequence, arrivalSeconds, departureSeconds });
  }

  const shapePoints = new Map();
  if (files["shapes.txt"]) {
    const shapesFile = csvRows(files["shapes.txt"], "shapes.txt");
    requireColumns("shapes.txt", shapesFile, ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"]);
    for (const [index, row] of shapesFile.records.entries()) {
      const sequence = row.shape_pt_sequence ? Number(row.shape_pt_sequence) : NaN;
      if (!row.shape_id || !Number.isSafeInteger(sequence) || sequence < 0) {
        throw new Error(`shapes.txt: row ${index + 2} has an invalid shape_id or shape_pt_sequence.`);
      }
      const points = shapePoints.get(row.shape_id) ?? [];
      if (points.length >= MAX_POINTS_PER_SHAPE) {
        throw new Error(`shapes.txt: shape "${row.shape_id}" exceeds the ${MAX_POINTS_PER_SHAPE} point limit.`);
      }
      points.push([coordinate(row.shape_pt_lat, "shape_pt_lat", index + 2, "shapes.txt"), coordinate(row.shape_pt_lon, "shape_pt_lon", index + 2, "shapes.txt"), sequence]);
      shapePoints.set(row.shape_id, points);
    }
    for (const points of shapePoints.values()) {
      points.sort((a, b) => a[2] - b[2]);
      if (points.length < 2 || new Set(points.map((point) => point[2])).size !== points.length) {
        throw new Error("shapes.txt: every shape must have at least two points with unique sequence values.");
      }
    }
  }

  const serviceFiles = {};
  for (const name of ["calendar.txt", "calendar_dates.txt"]) {
    if (files[name]) serviceFiles[name.replace(".txt", "")] = files[name];
  }
  const services = parseServiceDates(serviceFiles, tripsFile.records);
  const serviceCalendarAvailable = Boolean(serviceFiles.calendar || serviceFiles.calendar_dates);

  const routeVariants = new Map();
  const trips = [];
  for (const [tripId, trip] of tripIndex) {
    const stopTimes = stopTimesByTrip.get(tripId).sort((a, b) => a.sequence - b.sequence);
    if (stopTimes.length < 2) throw new Error(`trip "${tripId}" must contain at least two stop_times rows.`);
    if (stopTimes.length > MAX_STOPS_PER_TRIP) {
      throw new Error(`trip "${tripId}" exceeds the ${MAX_STOPS_PER_TRIP} stop limit.`);
    }
    for (let i = 1; i < stopTimes.length; i++) {
      if (stopTimes[i].sequence <= stopTimes[i - 1].sequence) {
        throw new Error(`trip "${tripId}" has duplicate or unordered stop_sequence values.`);
      }
      if (stopTimes[i].arrivalSeconds < stopTimes[i - 1].departureSeconds) {
        throw new Error(`trip "${tripId}" has a time that moves backwards.`);
      }
    }

    const route = routeIndex.get(trip.route_id);
    const shapeId = trip.shape_id || "";
    if (shapeId && files["shapes.txt"] && !shapePoints.has(shapeId)) {
      throw new Error(`trip "${tripId}" references unknown shape_id "${shapeId}".`);
    }
    const directionId = trip.direction_id === "1" ? "1" : "0";
    const variantStopIds = stopTimes.map((item) => stopIds.get(item.stopId));
    const variantKey = JSON.stringify([trip.route_id, directionId, shapeId, variantStopIds]);
    let variant = routeVariants.get(variantKey);
    if (!variant) {
      const id = `gtfs-${stableId(variantKey)}`;
      const shape = shapeId ? shapePoints.get(shapeId)?.map(([lat, lng]) => [lat, lng]) : null;
      variant = {
        id,
        number: route.route_short_name || route.route_long_name,
        name: route.route_long_name || route.route_short_name,
        nameKn: route.route_long_name || route.route_short_name,
        gtfsRouteId: trip.route_id,
        gtfsDirectionId: directionId,
        gtfsShapeId: shapeId || null,
        stopIds: variantStopIds,
        polyline: shape || variantStopIds.map((stopId) => {
          const stop = stopsById.get(stopId);
          return [stop.lat, stop.lng];
        }),
        shapeApprox: !shape,
        timetable: null,
        verified: false,
        source: "gtfs-upload",
        demo: false,
        allowReverse: false,
        availableDirections: [0],
        routeType: Number(route.route_type),
      };
      routeVariants.set(variantKey, variant);
    }
    trips.push({
      id: tripId,
      gtfsTripId: tripId,
      routeId: variant.id,
      serviceId: trip.service_id,
      headsign: trip.trip_headsign || null,
      stopTimes: stopTimes.map((item) => ({ ...item, stopId: stopIds.get(item.stopId) })),
    });
  }

  if (!routeVariants.size) throw new Error("GTFS feed contains no usable route trips.");
  const feedId = `${Date.now()}-${randomUUID()}`;
  const agencies = files["agency.txt"] ? csvRows(files["agency.txt"], "agency.txt") : null;
  let timezone = "Asia/Kolkata";
  if (agencies) {
    requireColumns("agency.txt", agencies, ["agency_timezone"]);
    const timezones = new Set(agencies.records.map((agency) => agency.agency_timezone).filter(Boolean));
    if (timezones.size !== 1) throw new Error("agency.txt must specify exactly one agency_timezone.");
    [timezone] = timezones;
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch {
      throw new Error(`agency.txt contains an unsupported timezone "${timezone}".`);
    }
  }
  return {
    feedId,
    source: "gtfs-upload",
    sourceLabel: "Unverified GTFS upload",
    verified: false,
    importedAt: new Date().toISOString(),
    routeCount: routeVariants.size,
    stopCount: stops.length,
    tripCount: trips.length,
    serviceCalendarAvailable,
    timezone,
    timezoneSource: agencies ? "agency.txt" : "Asia/Kolkata default",
    routes: [...routeVariants.values()],
    stops,
    trips,
    services: Object.fromEntries(services),
  };
}

export async function readGtfsZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_ZIP_BYTES) {
    throw new Error(`GTFS ZIP must be between 1 byte and ${MAX_ZIP_BYTES / 1024 / 1024} MB.`);
  }
  const zip = await yauzl.fromBufferPromise(buffer, { lazyEntries: true, validateEntrySizes: true });
  const files = {};
  let totalUncompressed = 0;
  let entryCount = 0;
  for await (const entry of zip.eachEntry()) {
    entryCount++;
    if (entryCount > 2000) throw new Error("GTFS ZIP contains too many entries.");
    const normalized = entry.fileName.replace(/\\/g, "/");
    if (normalized.startsWith("/") || normalized.split("/").some((part) => part === ".." || part === ".")) {
      throw new Error("GTFS ZIP contains an unsafe path.");
    }
    if (normalized.endsWith("/")) continue;
    const baseName = normalized.split("/").pop().toLowerCase();
    if (!baseName.endsWith(".txt")) continue;
    if (!REQUIRED_FILES.includes(baseName) && !["shapes.txt", "calendar.txt", "calendar_dates.txt", "agency.txt"].includes(baseName)) continue;
    if (files[baseName]) throw new Error(`GTFS ZIP contains more than one ${baseName}.`);
    if (entry.uncompressedSize > MAX_FILE_BYTES) throw new Error(`${baseName} exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB limit.`);
    totalUncompressed += entry.uncompressedSize;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) throw new Error("GTFS ZIP expands beyond the uncompressed size limit.");
    const stream = await zip.openReadStreamPromise(entry);
    const chunks = [];
    let bytes = 0;
    for await (const chunk of stream) {
      bytes += chunk.length;
      if (bytes > MAX_FILE_BYTES) throw new Error(`${baseName} exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB limit.`);
      chunks.push(chunk);
    }
    files[baseName] = Buffer.concat(chunks).toString("utf8");
  }
  return parseGtfsFiles(files);
}
