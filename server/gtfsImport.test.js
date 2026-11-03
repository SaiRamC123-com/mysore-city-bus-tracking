import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGtfsFiles, readGtfsZip } from "./src/services/gtfsImport.js";
import { tripsAround, tripsForDay } from "./src/services/scheduleService.js";

const feedFiles = {
  "routes.txt": "route_id,route_short_name,route_long_name,route_type\nr/1,7,\"Zoo, City Centre\",3\n",
  "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\ns/1,Start,12.3,76.6\ns/2,\"Zoo, Main\",12.31,76.61\ns/3,End,12.32,76.62\n",
  "trips.txt": "route_id,service_id,trip_id,shape_id,direction_id\nr/1,weekday,t/1,shape/1,0\n",
  "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\nt/1,07:00:00,07:00:00,s/1,1\nt/1,07:10:00,07:11:00,s/2,2\nt/1,07:20:00,07:20:00,s/3,3\n",
  "shapes.txt": "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nshape/1,12.3,76.6,1\nshape/1,12.31,76.61,2\nshape/1,12.32,76.62,3\n",
  "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nweekday,1,1,1,1,1,0,0,20260101,20261231\n",
};

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStored(files) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const [fileName, value] of Object.entries(files)) {
    const name = Buffer.from(fileName);
    const data = Buffer.from(value);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

test("parses a GTFS feed and labels imported routes unverified", () => {
  const parsed = parseGtfsFiles(feedFiles);
  assert.equal(parsed.routeCount, 1);
  assert.equal(parsed.stopCount, 3);
  assert.equal(parsed.tripCount, 1);
  assert.equal(parsed.verified, false);
  assert.equal(parsed.routes[0].number, "7");
  assert.equal(parsed.routes[0].shapeApprox, false);
  assert.equal(parsed.routes[0].stopIds.length, 3);
  assert.equal(parsed.trips[0].stopTimes[1].arrivalSeconds, 7 * 3600 + 10 * 60);
  assert.equal(parsed.stops.find((stop) => stop.name === "Zoo, Main").verified, false);
  assert.ok(parsed.routes[0].id.startsWith("gtfs-"));
  assert.ok(parsed.stops.every((stop) => stop.id.startsWith("gtfs-stop-")));
});

test("accepts GTFS times beyond midnight and makes a stop-to-stop schematic without shapes", () => {
  const { "shapes.txt": _shapeFile, ...withoutShapes } = feedFiles;
  withoutShapes["trips.txt"] = "route_id,service_id,trip_id\nr/1,weekday,t/1\n";
  withoutShapes["stop_times.txt"] = feedFiles["stop_times.txt"].replaceAll("07:", "25:");
  const parsed = parseGtfsFiles(withoutShapes);
  assert.equal(parsed.routes[0].shapeApprox, true);
  assert.equal(parsed.trips[0].stopTimes[0].arrivalSeconds, 25 * 3600);
});

test("rejects missing required files, invalid coordinates, and broken references", () => {
  assert.throws(() => parseGtfsFiles({}), /missing required routes\.txt/);
  assert.throws(
    () => parseGtfsFiles({ ...feedFiles, "stops.txt": feedFiles["stops.txt"].replace("12.3", "91") }),
    /invalid stop_lat/
  );
  assert.throws(
    () => parseGtfsFiles({ ...feedFiles, "stop_times.txt": feedFiles["stop_times.txt"].replace("s/2", "unknown") }),
    /unknown stop_id/
  );
});

test("rejects unordered stop sequences and invalid shapes", () => {
  assert.throws(
    () => parseGtfsFiles({ ...feedFiles, "stop_times.txt": feedFiles["stop_times.txt"].replace("s/2,2", "s/2,1") }),
    /duplicate or unordered stop_sequence/
  );
  assert.throws(
    () => parseGtfsFiles({ ...feedFiles, "shapes.txt": feedFiles["shapes.txt"].replace("12.31,76.61,2", "12.31,76.61,1") }),
    /unique sequence values/
  );
});

test("reads nested GTFS files from a ZIP archive", async () => {
  const zip = zipStored(Object.fromEntries(Object.entries(feedFiles).map(([name, value]) => [`mysuru-feed/${name}`, value])));
  const parsed = await readGtfsZip(zip);
  assert.equal(parsed.routeCount, 1);
  assert.equal(parsed.tripCount, 1);
});

test("rejects unsafe ZIP entry paths", async () => {
  const zip = zipStored({ "../routes.txt": feedFiles["routes.txt"] });
  await assert.rejects(() => readGtfsZip(zip), /unsafe path|invalid relative path/);
});

test("uses GTFS service calendars to produce scheduled trips for the feed timezone", () => {
  const route = {
    id: "route",
    timezone: "Asia/Kolkata",
    serviceCalendarAvailable: true,
    gtfsTrips: [{
      id: "trip",
      serviceId: "weekday",
      service: {
        weekdays: [true, true, true, true, true, false, false],
        startDate: "20260101",
        endDate: "20261231",
        exceptions: {},
      },
      stopTimes: [{ stopId: "a", arrivalSeconds: 7 * 3600, departureSeconds: 7 * 3600 }],
    }],
    availableDirections: [0],
  };
  const wednesday = Date.UTC(2026, 3, 15, 12);
  const trips = tripsForDay(route, wednesday);
  assert.equal(trips.length, 1);
  assert.equal(new Date(trips[0].departTs).toISOString(), "2026-04-15T01:30:00.000Z");
  assert.equal(tripsForDay({ ...route, serviceCalendarAvailable: false }, wednesday).length, 0);

  const afterMidnightTrip = {
    ...route,
    gtfsTrips: [{
      ...route.gtfsTrips[0],
      stopTimes: [{ stopId: "a", arrivalSeconds: 25 * 3600, departureSeconds: 25 * 3600 }],
    }],
  };
  const thursday = Date.UTC(2026, 3, 15, 19, 30);
  assert.ok(tripsAround(afterMidnightTrip, thursday).some((trip) => trip.departTs === thursday));
});
