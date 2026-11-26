"""Receive vehicle snapshots from the owner's Scriptable widget."""

import asyncio
from datetime import UTC, datetime
import json
import logging
from pathlib import Path

from aiohttp import web

from homeassistant.components import frontend, webhook
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import CONF_PUBLIC_URL, CONF_WEBHOOK_ID, DOMAIN
from .photo import MAX_PHOTO_BYTES, VehiclePhoto
from .snapshot import VehicleSnapshot

_LOGGER = logging.getLogger(__name__)
_PLATFORMS = (Platform.SENSOR, Platform.BINARY_SENSOR, Platform.DEVICE_TRACKER, Platform.IMAGE)
_MAX_BODY_BYTES = 64 * 1024
_CARD_URL = f"/api/{DOMAIN}/bmw-linker-ha-card.js"


class VehicleCoordinator(DataUpdateCoordinator[VehicleSnapshot]):
    """Remember the newest vehicle report and notify HA entities."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        super().__init__(hass, _LOGGER, name=DOMAIN, config_entry=entry)
        self.store: Store[dict] = Store(
            hass, 1, f"{DOMAIN}.{entry.entry_id}", private=True, atomic_writes=True
        )
        self.photo_store: Store[dict] = Store(
            hass, 1, f"{DOMAIN}.{entry.entry_id}.photo", private=True, atomic_writes=True
        )
        self.photo: VehiclePhoto | None = None
        self.lock = asyncio.Lock()
        self.accepting_updates = True
        self.require_https = bool(entry.data.get(CONF_PUBLIC_URL))

    async def async_restore(self) -> None:
        if (stored_photo := await self.photo_store.async_load()) is not None:
            try:
                self.photo = VehiclePhoto.from_storage(stored_photo)
            except (KeyError, TypeError, ValueError):
                _LOGGER.warning("Ignoring invalid stored BMW vehicle image")
        if (payload := await self.store.async_load()) is None:
            return
        try:
            self.async_set_updated_data(
                VehicleSnapshot.from_payload(payload, now=datetime.now(UTC))
            )
        except ValueError:
            _LOGGER.warning("Ignoring invalid stored My BMW vehicle state")

    async def async_webhook(
        self, hass: HomeAssistant, webhook_id: str, request: web.Request
    ) -> web.Response:
        if self.require_https and not getattr(request, "secure", False):
            return web.json_response({"error": "https_required"}, status=403)
        photo_upload = request.content_type == "image/png"
        limit = MAX_PHOTO_BYTES if photo_upload else _MAX_BODY_BYTES
        body = bytearray()
        stream = request.content
        while len(body) <= limit:
            chunk = await stream.read(limit + 1 - len(body))
            if not chunk:
                break
            body.extend(chunk)
        if len(body) > limit:
            return web.json_response({"error": "payload_too_large"}, status=413)
        if photo_upload:
            return await self.async_store_photo(request.headers.get("X-BMW-VIN", ""), bytes(body))
        try:
            payload = json.loads(body)
        except (ValueError, RecursionError):
            return web.json_response({"error": "invalid_json"}, status=400)
        try:
            snapshot = VehicleSnapshot.from_payload(payload, now=datetime.now(UTC))
        except ValueError as err:
            return web.json_response({"error": str(err)}, status=400)

        async with self.lock:
            if not self.accepting_updates:
                return web.json_response({"error": "bridge_unloading"}, status=503)
            if previous := self.data:
                if snapshot.reported_at < previous.reported_at or (
                    snapshot.reported_at == previous.reported_at and snapshot.version == 1
                ):
                    return web.json_response({"mybmw_bridge": "unchanged"})
                snapshot = snapshot.with_cached_trips(previous)
                if snapshot == previous:
                    return web.json_response({"mybmw_bridge": "unchanged"})
            await self.store.async_save(snapshot.as_payload())
            self.async_set_updated_data(snapshot)
        return web.json_response({"mybmw_bridge": "updated"})

    @property
    def vehicle_photo(self) -> VehiclePhoto | None:
        vin = self.data.values.get("vin") if self.data else None
        if self.photo and isinstance(vin, str) and self.photo.vin == vin.upper():
            return self.photo
        return None

    async def async_store_photo(self, vin: str, data: bytes) -> web.Response:
        try:
            photo = VehiclePhoto.from_png(vin.upper(), data, datetime.now(UTC))
        except ValueError as err:
            return web.json_response({"error": str(err)}, status=400)

        async with self.lock:
            if not self.accepting_updates:
                return web.json_response({"error": "bridge_unloading"}, status=503)
            snapshot = self.data
            if snapshot is None:
                return web.json_response({"error": "vehicle_mismatch"}, status=409)
            current_vin = snapshot.values.get("vin")
            if not isinstance(current_vin, str) or current_vin.upper() != photo.vin:
                return web.json_response({"error": "vehicle_mismatch"}, status=409)
            if self.photo and self.photo.vin == photo.vin and self.photo.data == data:
                return web.json_response({"mybmw_bridge": "photo_unchanged"})
            await self.photo_store.async_save(photo.as_storage_data())
            self.photo = photo
            self.async_set_updated_data(snapshot)
        return web.json_response({"mybmw_bridge": "photo_updated"})


type MyBmwBridgeConfigEntry = ConfigEntry[VehicleCoordinator]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    card = Path(__file__).with_name("bmw-linker-ha-card.js")
    await hass.http.async_register_static_paths([StaticPathConfig(_CARD_URL, str(card), False)])
    frontend.add_extra_js_url(hass, f"{_CARD_URL}?v=0.5.0")
    return True


async def async_setup_entry(hass: HomeAssistant, entry: MyBmwBridgeConfigEntry) -> bool:
    coordinator = VehicleCoordinator(hass, entry)
    entry.runtime_data = coordinator
    await coordinator.async_restore()
    await hass.config_entries.async_forward_entry_setups(entry, _PLATFORMS)

    webhook_id = entry.data[CONF_WEBHOOK_ID]
    webhook.async_register(
        hass,
        DOMAIN,
        entry.title,
        webhook_id,
        coordinator.async_webhook,
        local_only=not coordinator.require_https,
        allowed_methods=("POST",),
    )
    return True


async def async_unload_entry(hass: HomeAssistant, entry: MyBmwBridgeConfigEntry) -> bool:
    if not await hass.config_entries.async_unload_platforms(entry, _PLATFORMS):
        return False
    coordinator = entry.runtime_data
    coordinator.accepting_updates = False
    async with coordinator.lock:
        webhook.async_unregister(hass, entry.data[CONF_WEBHOOK_ID])
    return True


async def async_remove_entry(hass: HomeAssistant, entry: MyBmwBridgeConfigEntry) -> None:
    await Store(hass, 1, f"{DOMAIN}.{entry.entry_id}", private=True).async_remove()
    await Store(hass, 1, f"{DOMAIN}.{entry.entry_id}.photo", private=True).async_remove()
