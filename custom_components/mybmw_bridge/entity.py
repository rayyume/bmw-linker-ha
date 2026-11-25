"""Shared identity for the vehicle's entities."""

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import MyBmwBridgeConfigEntry, VehicleCoordinator
from .const import DOMAIN


class BridgeEntity(CoordinatorEntity[VehicleCoordinator]):
    _attr_has_entity_name = True

    def __init__(self, entry: MyBmwBridgeConfigEntry, key: str) -> None:
        super().__init__(entry.runtime_data)
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            manufacturer="BMW",
            name=entry.title,
        )
