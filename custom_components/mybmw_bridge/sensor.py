"""Expose the last vehicle report and its measurements."""

from datetime import datetime

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.const import PERCENTAGE, EntityCategory, UnitOfLength
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import MyBmwBridgeConfigEntry
from .entity import BridgeEntity

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
)


async def async_setup_entry(
    hass: HomeAssistant, entry: MyBmwBridgeConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities(VehicleSensor(entry, description) for description in _DESCRIPTIONS)


class VehicleSensor(BridgeEntity, SensorEntity):
    def __init__(
        self, entry: MyBmwBridgeConfigEntry, description: SensorEntityDescription
    ) -> None:
        super().__init__(entry, description.key)
        self.entity_description = description

    @property
    def native_value(self) -> int | float | datetime | None:
        snapshot = self.coordinator.data
        if snapshot is None:
            return None
        if self.entity_description.key == "reported_at":
            return snapshot.reported_at
        value = snapshot.values.get(self.entity_description.key)
        return value if isinstance(value, (int, float)) else None
