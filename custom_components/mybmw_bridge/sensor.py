"""Expose the last vehicle report and its measurements."""

from datetime import datetime

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.const import (
    DEGREE,
    PERCENTAGE,
    EntityCategory,
    UnitOfEnergyDistance,
    UnitOfLength,
    UnitOfPressure,
    UnitOfTime,
    UnitOfVolume,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import MyBmwBridgeConfigEntry
from .entity import BridgeEntity
from .telemetry import WHEELS


def _measurement(
    key: str, unit: str | None = None, device_class: SensorDeviceClass | None = None
) -> SensorEntityDescription:
    return SensorEntityDescription(
        key=key,
        translation_key=key,
        device_class=device_class,
        native_unit_of_measurement=unit,
        state_class=SensorStateClass.MEASUREMENT,
    )

_DESCRIPTIONS = (
    SensorEntityDescription(
        key="battery_percent", translation_key="battery_percent",
        device_class=SensorDeviceClass.BATTERY,
        native_unit_of_measurement=PERCENTAGE, state_class=SensorStateClass.MEASUREMENT,
    ),
    SensorEntityDescription(
        key="fuel_percent", translation_key="fuel_percent",
        native_unit_of_measurement=PERCENTAGE, state_class=SensorStateClass.MEASUREMENT,
    ),
    SensorEntityDescription(
        key="fuel_range_km", translation_key="fuel_range_km",
        device_class=SensorDeviceClass.DISTANCE,
        native_unit_of_measurement=UnitOfLength.KILOMETERS,
        state_class=SensorStateClass.MEASUREMENT,
    ),
    SensorEntityDescription(
        key="electric_range_km", translation_key="electric_range_km",
        device_class=SensorDeviceClass.DISTANCE,
        native_unit_of_measurement=UnitOfLength.KILOMETERS,
        state_class=SensorStateClass.MEASUREMENT,
    ),
    SensorEntityDescription(
        key="odometer_km", translation_key="odometer_km",
        device_class=SensorDeviceClass.DISTANCE,
        native_unit_of_measurement=UnitOfLength.KILOMETERS,
        state_class=SensorStateClass.TOTAL_INCREASING,
    ),
    SensorEntityDescription(
        key="reported_at", translation_key="reported_at",
        device_class=SensorDeviceClass.TIMESTAMP, entity_category=EntityCategory.DIAGNOSTIC,
    ),
    _measurement("fuel_liters", UnitOfVolume.LITERS, SensorDeviceClass.VOLUME_STORAGE),
    _measurement("charging_target_percent", PERCENTAGE),
    _measurement("remaining_charging_minutes", UnitOfTime.MINUTES, SensorDeviceClass.DURATION),
    _measurement("location_accuracy", UnitOfLength.METERS, SensorDeviceClass.DISTANCE),
    _measurement("check_control_count"),
    *(
        SensorEntityDescription(key=key, translation_key=key, native_unit_of_measurement=DEGREE)
        for key in ("latitude", "longitude")
    ),
    *(
        _measurement(f"{wheel}_{key}", UnitOfPressure.KPA, SensorDeviceClass.PRESSURE)
        for wheel in WHEELS
        for key in ("pressure", "target_pressure")
    ),
    *(
        _measurement(f"{period}_fuel_consumption", "L/100km")
        for period in ("last_trip", "monthly")
    ),
    *(
        _measurement(
            f"{period}_electric_consumption", UnitOfEnergyDistance.KILO_WATT_HOUR_PER_100_KM
        )
        for period in ("last_trip", "monthly")
    ),
    *(
        SensorEntityDescription(key=key, translation_key=key)
        for key in (
            "address", "brand", "model", "vin", "license_plate", "door_security_status",
            "charging_status", "consumption_summary",
        )
    ),
)


async def async_setup_entry(
    hass: HomeAssistant, entry: MyBmwBridgeConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([
        *(VehicleSensor(entry, description) for description in _DESCRIPTIONS),
        VehicleDetails(entry),
    ])


class VehicleSensor(BridgeEntity, SensorEntity):
    def __init__(
        self, entry: MyBmwBridgeConfigEntry, description: SensorEntityDescription
    ) -> None:
        super().__init__(entry, description.key)
        self.entity_description = description

    @property
    def native_value(self) -> int | float | str | datetime | None:
        snapshot = self.coordinator.data
        if snapshot is None:
            return None
        if self.entity_description.key == "reported_at":
            return snapshot.reported_at
        value = snapshot.values.get(self.entity_description.key)
        return value if type(value) in (int, float, str) else None


class VehicleDetails(BridgeEntity, SensorEntity):
    """Expose BMW-specific fields alongside the individual sensors."""

    _attr_translation_key = "vehicle_details"
    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _unrecorded_attributes = frozenset({"vehicle", "vehicle_state", "trips"})

    def __init__(self, entry: MyBmwBridgeConfigEntry) -> None:
        super().__init__(entry, "vehicle_details")

    @property
    def native_value(self) -> datetime | None:
        snapshot = self.coordinator.data
        return snapshot.reported_at if snapshot and snapshot.version == 2 else None

    @property
    def extra_state_attributes(self) -> dict | None:
        snapshot = self.coordinator.data
        if snapshot and snapshot.version == 2:
            return {"vehicle": snapshot.vehicle, "vehicle_state": snapshot.state, "trips": snapshot.trips}
        return None
