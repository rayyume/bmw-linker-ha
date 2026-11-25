"""Validate and retain vehicle reports sent from Scriptable."""

from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from math import isfinite
import re
from typing import Any

from .telemetry import DOOR_STATES, Telemetry, number, project_vehicle

_PERCENT_FIELDS = ("fuel_percent", "battery_percent")
_DISTANCE_FIELDS = ("fuel_range_km", "electric_range_km", "odometer_km")
_PRIVATE_FIELDS = {
    "accesstoken", "refreshtoken", "idtoken", "token", "password", "encryptedpassword",
    "authorization", "cookie", "cookies", "gcid", "accountid", "userid", "phonenumber",
    "phone", "email", "otp", "otpcode", "clientsecret", "apikey", "privatekey",
    "digitalkey", "credential", "credentials",
}
_PRIVATE_URL = re.compile(r"[?&](?:access_token|refresh_token|id_token|token|api_key|key)=", re.I)


def _clean_json(value: Any, depth: int = 0) -> Any:
    """Keep metadata and lists publishable as HA state attributes."""
    if depth > 20:
        return None
    if isinstance(value, dict):
        return {
            key: _clean_json(item, depth + 1)
            for key, item in value.items()
            if re.sub(r"[^a-z]", "", key.lower()) not in _PRIVATE_FIELDS
        }
    if isinstance(value, list):
        return [_clean_json(item, depth + 1) for item in value]
    if isinstance(value, str):
        return None if value[:5].lower() == "data:" or _PRIVATE_URL.search(value) else value
    return None if isinstance(value, float) and not isfinite(value) else value


def _section(payload: dict, key: str) -> dict:
    value = payload.get(key)
    return _clean_json(value) if isinstance(value, dict) else {}


@dataclass(frozen=True)
class VehicleSnapshot:
    reported_at: datetime
    values: Telemetry
    version: int = 1
    vehicle: dict = field(default_factory=dict)
    state: dict = field(default_factory=dict)
    trips: dict = field(default_factory=dict)

    @classmethod
    def from_payload(cls, payload: object, *, now: datetime) -> "VehicleSnapshot":
        if (
            not isinstance(payload, dict)
            or type(payload.get("version")) is not int
            or payload["version"] not in (1, 2)
        ):
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

        if payload["version"] == 2:
            vehicle = _section(payload, "vehicle")
            state = _section(payload, "state")
            trips = _section(payload, "trips")
            if not (vehicle or state or trips):
                raise ValueError("missing_vehicle_state")
            return cls(reported_at, project_vehicle(vehicle, state, trips), 2, vehicle, state, trips)

        values: Telemetry = {}
        for key in (*_PERCENT_FIELDS, *_DISTANCE_FIELDS):
            maximum = 100 if key in _PERCENT_FIELDS else float("inf")
            if (value := number(payload.get(key), maximum=maximum)) is not None:
                values[key] = value
        doors = payload.get("door_state")
        if isinstance(doors, str) and doors in DOOR_STATES:
            values["door_state"] = DOOR_STATES[doors]
        if not values:
            raise ValueError("missing_vehicle_state")
        return cls(reported_at, values)

    def with_cached_trips(self, previous: "VehicleSnapshot") -> "VehicleSnapshot":
        """Keep the last trip report when BMW reuses the same vehicle's trip cache."""
        vin = self.vehicle.get("vin")
        old_vin = previous.vehicle.get("vin")
        if (
            self.trips
            or not previous.trips
            or not isinstance(vin, str)
            or not vin.strip()
            or not isinstance(old_vin, str)
            or vin.upper() != old_vin.upper()
        ):
            return self
        return replace(
            self,
            trips=previous.trips,
            values=project_vehicle(self.vehicle, self.state, previous.trips),
        )

    def as_payload(self) -> dict:
        payload = {"version": self.version, "reported_at": self.reported_at.isoformat()}
        if self.version == 2:
            return {**payload, "vehicle": self.vehicle, "state": self.state, "trips": self.trips}
        return {**payload, **self.values}
