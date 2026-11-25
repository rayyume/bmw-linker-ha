"""Validate the small set of data accepted from Scriptable."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

PERCENT_FIELDS = ("fuel_percent", "battery_percent")
DISTANCE_FIELDS = ("fuel_range_km", "electric_range_km", "odometer_km")
DOOR_STATES = ("LOCKED", "UNLOCKED")


@dataclass(frozen=True)
class VehicleSnapshot:
    reported_at: datetime
    values: dict[str, int | float | str]

    @classmethod
    def from_payload(cls, payload: object, *, now: datetime) -> "VehicleSnapshot":
        if not isinstance(payload, dict) or payload.get("version") != 1:
            raise ValueError("unsupported_payload")
        timestamp = payload.get("reported_at")
        if not isinstance(timestamp, str):
            raise ValueError("invalid_timestamp")
        try:
            reported_at = datetime.fromisoformat(timestamp)
            if reported_at.tzinfo is None:
                raise ValueError
            reported_at = reported_at.astimezone(UTC)
        except (ValueError, OverflowError) as err:
            raise ValueError("invalid_timestamp") from err
        if reported_at.year < 2000 or reported_at > now + timedelta(minutes=5):
            raise ValueError("invalid_timestamp")

        values: dict[str, int | float | str] = {}
        for field in (*PERCENT_FIELDS, *DISTANCE_FIELDS):
            value = payload.get(field)
            if type(value) not in (int, float) or not 0 <= value < float("inf"):
                continue
            if field in PERCENT_FIELDS and value > 100:
                continue
            values[field] = value

        doors = payload.get("door_state")
        if doors in DOOR_STATES:
            values["door_state"] = doors
        if not values:
            raise ValueError("missing_vehicle_state")
        return cls(reported_at, values)

    def as_payload(self) -> dict:
        return {"version": 1, "reported_at": self.reported_at.isoformat(), **self.values}
