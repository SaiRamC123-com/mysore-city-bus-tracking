import test from "node:test";
import assert from "node:assert/strict";
import { calculateSeatOccupancy } from "./src/services/occupancy.js";

test("seat counts and availability are calculated independently for each bus", () => {
  const d4 = calculateSeatOccupancy({ occupiedPassengers: 24, seatCapacity: 40, standingPassengers: 0 });
  const d5 = calculateSeatOccupancy({ occupiedPassengers: 15, seatCapacity: 50, standingPassengers: 0 });
  const d6 = calculateSeatOccupancy({ occupiedPassengers: 40, seatCapacity: 40, standingPassengers: 2 });

  assert.deepEqual(
    [d4.occupiedSeats, d4.availableSeats, d4.standingPassengers],
    [24, 16, 0],
  );
  assert.deepEqual(
    [d5.occupiedSeats, d5.availableSeats, d5.standingPassengers],
    [15, 35, 0],
  );
  assert.deepEqual(
    [d6.occupiedSeats, d6.availableSeats, d6.standingPassengers],
    [38, 2, 2],
  );
});

test("crowd status follows the seat occupancy thresholds", () => {
  const statusAt = (occupiedSeats, seatCapacity = 100) =>
    calculateSeatOccupancy({ occupiedPassengers: occupiedSeats, seatCapacity, standingPassengers: 0 }).crowdStatus;

  assert.equal(statusAt(0), "free");
  assert.equal(statusAt(40), "free");
  assert.equal(statusAt(41), "normal");
  assert.equal(statusAt(70), "normal");
  assert.equal(statusAt(71), "crowded");
  assert.equal(statusAt(90), "crowded");
  assert.equal(statusAt(91), "full");
  assert.equal(statusAt(100), "full");
});

test("inconsistent or incomplete seat counts are unavailable", () => {
  assert.equal(calculateSeatOccupancy({ occupiedPassengers: 5, seatCapacity: 4, standingPassengers: 0 }), null);
  assert.equal(calculateSeatOccupancy({ occupiedPassengers: 2, seatCapacity: 4, standingPassengers: 3 }), null);
  assert.equal(calculateSeatOccupancy({ occupiedPassengers: 2, seatCapacity: 4, standingPassengers: null }), null);
});
