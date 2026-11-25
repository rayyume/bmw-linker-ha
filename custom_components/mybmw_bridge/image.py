"""Expose the synced picture through Home Assistant's image proxy."""

from homeassistant.components.image import ImageEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import MyBmwBridgeConfigEntry
from .entity import BridgeEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: MyBmwBridgeConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([VehicleImage(hass, entry)])


class VehicleImage(BridgeEntity, ImageEntity):
    _attr_translation_key = "vehicle_photo"
    _attr_content_type = "image/png"

    def __init__(self, hass: HomeAssistant, entry: MyBmwBridgeConfigEntry) -> None:
        super().__init__(entry, "vehicle_photo")
        ImageEntity.__init__(self, hass)
        self._update_timestamp()

    def _update_timestamp(self) -> None:
        photo = self.coordinator.vehicle_photo
        self._attr_image_last_updated = photo.updated_at if photo else None

    @callback
    def _handle_coordinator_update(self) -> None:
        self._update_timestamp()
        super()._handle_coordinator_update()

    async def async_image(self) -> bytes | None:
        photo = self.coordinator.vehicle_photo
        return photo.data if photo else None
