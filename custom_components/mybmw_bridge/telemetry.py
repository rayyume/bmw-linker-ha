"""Project BMW's vehicle report onto stable Home Assistant entities."""

from collections.abc import Mapping
from typing import Any

type TelemetryValue = int | float | str | bool
type Telemetry = dict[str, TelemetryValue]

WHEELS = {
    "front_left": "frontLeft",
    "front_right": "frontRight",
    "rear_left": "rearLeft",
    "rear_right": "rearRight",
}

OPENINGS = {
    "doors": ("doorsState", "combinedState"),
    "windows": ("windowsState", "combinedState"),
    "hood": ("doorsState", "hood"),
    "trunk": ("doorsState", "trunk"),
    "sunroof": ("roofState", "roofState"),
    **{f"door_{wheel}": ("doorsState", name) for wheel, name in WHEELS.items()},
    **{f"window_{wheel}": ("windowsState", name) for wheel, name in WHEELS.items()},
}

DOOR_STATES = {
    "LOCKED": "LOCKED",
    "SECURED": "LOCKED",
    "UNLOCKED": "UNLOCKED",
    "SELECTIVE_LOCKED": "UNLOCKED",
    "PARTIALLY_LOCKED": "UNLOCKED",
}
_OPEN_STATES = {
    "CLOSED": False,
    "OPEN": True,
    "OPEN_TILT": True,
    "INTERMEDIATE": True,
    "PARTIALLY_OPEN": True,
}


def number(value: Any, minimum: float = 0, maximum: float = float("inf")) -> int | float | None:
    if isinstance(value, str):
        try:
            value = float(value)
        except ValueError:
            return None
    if type(value) in (float, int) and minimum <= value <= maximum and value < float("inf"):
        return value
    return None


def _get(data: Any, *path: str) -> Any:
    for key in path:
        if not isinstance(data, dict):
            return None
        data = data.get(key)
    return data


def _state(mapping: Mapping[str, TelemetryValue], value: Any) -> TelemetryValue | None:
    return mapping.get(value) if isinstance(value, str) else None


def _text(value: Any) -> str | None:
    return value[:255] if isinstance(value, str) and value.strip() else None


def project_vehicle(vehicle: dict, state: dict, trips: dict) -> Telemetry:
    """Extract measurements with known formats, keeping missing values unknown."""
    electric = _get(state, "electricChargingState")
    fuel = _get(state, "combustionFuelLevel")
    location = _get(state, "location")
    coordinates = _get(location, "coordinates")
    report = _get(trips, "widget")
    display = _get(vehicle, "scriptableDisplay")
    last_trip = _get(report, "lastTrip")
    monthly = _get(report, "monthly")
    battery_target = number(_get(electric, "chargingTarget"), maximum=100)
    if battery_target is None:
        battery_target = number(
            _get(state, "chargingProfile", "chargingSettings", "targetSoc"), maximum=100
        )
    locked = _get(state, "doorsState", "combinedSecurityState")
    messages = _get(state, "checkControlMessages")
    connected = _get(electric, "isChargerConnected")

    metrics = {
        "battery_percent": number(_get(electric, "chargingLevelPercent"), maximum=100),
        "fuel_percent": number(_get(fuel, "remainingFuelPercent"), maximum=100),
        "fuel_range_km": number(_get(fuel, "range")),
        "electric_range_km": number(_get(electric, "range")),
        "odometer_km": number(_get(state, "currentMileage")),
        "fuel_liters": number(_get(fuel, "remainingFuelLiters")),
        "door_state": _state(DOOR_STATES, locked),
        "door_security_status": _text(locked),
        "charger_connected": connected if type(connected) is bool else None,
        "charging_status": _text(_get(electric, "chargingStatus")),
        "charging_target_percent": battery_target,
        "remaining_charging_minutes": number(_get(electric, "remainingChargingMinutes")),
        "latitude": number(_get(coordinates, "latitude"), -90, 90),
        "longitude": number(_get(coordinates, "longitude"), -180, 180),
        "address": _text(_get(location, "address", "formatted")),
        "location_accuracy": number(_get(coordinates, "accuracy")),
        "brand": _text(_get(vehicle, "brand")),
        "model": _text(_get(vehicle, "model")),
        "vin": _text(_get(vehicle, "vin")),
        "license_plate": _text(_get(vehicle, "licensePlate")),
        "display_name": _text(_get(display, "name")),
        "display_plate": _text(_get(display, "licensePlate")),
        "fuel_tank_liters": number(_get(display, "fuelTankLiters"), 1, 250),
        "check_control_count": len(messages) if isinstance(messages, list) else None,
        "last_trip_fuel_consumption": number(_get(last_trip, "fuelConsumption", "averageConsumption")),
        "last_trip_electric_consumption": number(_get(last_trip, "electricConsumption", "averageConsumption")),
        "monthly_fuel_consumption": number(_get(monthly, "totalCombustionConsumption", "averageConsumption")),
        "monthly_electric_consumption": number(_get(monthly, "totalElectricConsumption", "averageConsumption")),
    }
    summary = _get(state, "averageConsumption")
    if isinstance(summary, list) and len(summary) >= 2 and summary[1]:
        metrics["consumption_summary"] = _text(f"{summary[0]} {summary[1]}")

    for key, path in OPENINGS.items():
        value = _get(state, *path)
        if isinstance(value, dict):
            value = value.get("state")
        metrics[f"{key}_open"] = _state(_OPEN_STATES, value)

    for wheel, source in WHEELS.items():
        status = _get(state, "tireState", source, "status")
        metrics[f"{wheel}_pressure"] = number(_get(status, "currentPressure"))
        metrics[f"{wheel}_target_pressure"] = number(_get(status, "targetPressure"))

    return {key: value for key, value in metrics.items() if value is not None}
