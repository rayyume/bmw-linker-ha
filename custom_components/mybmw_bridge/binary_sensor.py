"""Expose door security and indicate stale vehicle data."""

from collections.abc import Callable
from datetime import UTC, datetime

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_point_in_utc_time

from . import MyBmwBridgeConfigEntry
from .const import STALE_AFTER
from .entity import BridgeEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: MyBmwBridgeConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([DoorSecurity(entry), StaleReport(entry)])


class DoorSecurity(BridgeEntity, BinarySensorEntity):
    _attr_translation_key = "door_security"
    _attr_device_class = BinarySensorDeviceClass.LOCK

    def __init__(self, entry: MyBmwBridgeConfigEntry) -> None:
        super().__init__(entry, "door_security")

    @property
    def is_on(self) -> bool | None:
        snapshot = self.coordinator.data
        state = snapshot.values.get("door_state") if snapshot else None
        return state == "UNLOCKED" if state is not None else None


class StaleReport(BridgeEntity, BinarySensorEntity):
    _attr_translation_key = "stale_report"
    _attr_device_class = BinarySensorDeviceClass.PROBLEM
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, entry: MyBmwBridgeConfigEntry) -> None:
        super().__init__(entry, "stale_report")
        self._cancel_expiry: Callable[[], None] | None = None

    @property
    def is_on(self) -> bool | None:
        snapshot = self.coordinator.data
        if snapshot is None:
            return None
        return datetime.now(UTC) >= snapshot.reported_at + STALE_AFTER

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(self._cancel_timer)
        self._schedule_expiry()

    @callback
    def _handle_coordinator_update(self) -> None:
        self._schedule_expiry()
        super()._handle_coordinator_update()

    @callback
    def _schedule_expiry(self) -> None:
        self._cancel_timer()
        snapshot = self.coordinator.data
        if snapshot and (expiry := snapshot.reported_at + STALE_AFTER) > datetime.now(UTC):
            self._cancel_expiry = async_track_point_in_utc_time(
                self.hass, self._expired, expiry
            )

    @callback
    def _expired(self, now: datetime) -> None:
        self._cancel_expiry = None
        self.async_write_ha_state()

    @callback
    def _cancel_timer(self) -> None:
        if self._cancel_expiry:
            self._cancel_expiry()
            self._cancel_expiry = None
