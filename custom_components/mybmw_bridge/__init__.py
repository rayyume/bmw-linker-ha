"""Receive vehicle snapshots from the owner's Scriptable widget."""

import asyncio
from datetime import UTC, datetime
import json
import logging

from aiohttp import web

from homeassistant.components import webhook
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import CONF_PUBLIC_URL, CONF_WEBHOOK_ID, DOMAIN
from .snapshot import VehicleSnapshot

_LOGGER = logging.getLogger(__name__)
_PLATFORMS = (Platform.SENSOR, Platform.BINARY_SENSOR)
_MAX_BODY_BYTES = 4096


class VehicleCoordinator(DataUpdateCoordinator[VehicleSnapshot]):
    """Remember the newest vehicle report and notify HA entities."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        super().__init__(hass, _LOGGER, name=DOMAIN, config_entry=entry)
        self.store: Store[dict] = Store(
            hass, 1, f"{DOMAIN}.{entry.entry_id}", private=True, atomic_writes=True
        )
        self.lock = asyncio.Lock()
        self.accepting_updates = True
        self.require_https = bool(entry.data.get(CONF_PUBLIC_URL))

    async def async_restore(self) -> None:
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
        body = bytearray()
        stream = request.content
        while len(body) <= _MAX_BODY_BYTES:
            chunk = await stream.read(_MAX_BODY_BYTES + 1 - len(body))
            if not chunk:
                break
            body.extend(chunk)
        if len(body) > _MAX_BODY_BYTES:
            return web.json_response({"error": "payload_too_large"}, status=413)
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
            if self.data and snapshot.reported_at <= self.data.reported_at:
                return web.json_response({"mybmw_bridge": "unchanged"})
            await self.store.async_save(snapshot.as_payload())
            self.async_set_updated_data(snapshot)
        return web.json_response({"mybmw_bridge": "updated"})


type MyBmwBridgeConfigEntry = ConfigEntry[VehicleCoordinator]


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
