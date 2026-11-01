export function calculateSeatOccupancy({ occupiedPassengers, seatCapacity, standingPassengers }) {
  if (
    !Number.isInteger(occupiedPassengers) ||
    !Number.isInteger(seatCapacity) ||
    seatCapacity <= 0 ||
    !Number.isInteger(standingPassengers) ||
    occupiedPassengers < standingPassengers ||
    occupiedPassengers - standingPassengers > seatCapacity
  ) {
    return null;
  }

  const occupiedSeats = occupiedPassengers - standingPassengers;
  const availableSeats = seatCapacity - occupiedSeats;
  const occupancyPct = (occupiedSeats / seatCapacity) * 100;
  const crowdStatus =
    occupancyPct <= 40 ? "free" : occupancyPct <= 70 ? "normal" : occupancyPct <= 90 ? "crowded" : "full";

  return { occupiedSeats, availableSeats, standingPassengers, occupancyPct, crowdStatus };
}
