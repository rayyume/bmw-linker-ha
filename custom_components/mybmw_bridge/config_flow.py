"""Configure a webhook URL for a Scriptable widget."""

from urllib.parse import urlsplit, urlunsplit

import voluptuous as vol

from homeassistant.components import webhook
from homeassistant.config_entries import (
    SOURCE_RECONFIGURE,
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
)
from homeassistant.const import CONF_NAME
from homeassistant.helpers.network import NoURLAvailableError, get_url
from homeassistant.helpers.selector import TextSelector

from .const import CONF_LOCAL_URL, CONF_PUBLIC_URL, CONF_WEBHOOK_ID, DOMAIN


def _origin(url: str, *, require_https: bool = False) -> str:
    """Accept an HTTP(S) origin without credentials or a path."""
    if any(
        character.isspace() or ord(character) < 32 or character in "\\?#"
        for character in url
    ):
        raise ValueError("Invalid URL")
    parsed = urlsplit(url)
    schemes = ("https",) if require_https else ("http", "https")
    if (
        parsed.scheme not in schemes
        or not parsed.hostname
        or parsed.username is not None
        or parsed.path not in ("", "/")
        or parsed.port == 0
    ):
        raise ValueError("Invalid origin")
    return urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))


class MyBmwBridgeConfigFlow(ConfigFlow, domain=DOMAIN):
    """Configure one vehicle per webhook."""

    VERSION = 1

    def __init__(self) -> None:
        self._data: dict[str, str] = {}
        self._pair_url = ""
        self._vehicle_name = ""

    async def async_step_user(self, user_input: dict | None = None) -> ConfigFlowResult:
        return self._configure("user", user_input)

    async def async_step_reconfigure(
        self, user_input: dict | None = None
    ) -> ConfigFlowResult:
        return self._configure("reconfigure", user_input, self._get_reconfigure_entry())

    def _configure(
        self, step: str, user_input: dict | None, entry: ConfigEntry | None = None
    ) -> ConfigFlowResult:
        previous = entry.data if entry else {}
        errors: dict[str, str] = {}

        schema = {
            vol.Optional(CONF_PUBLIC_URL): TextSelector(),
            vol.Optional(CONF_LOCAL_URL): TextSelector(),
        }
        if entry is None:
            schema[vol.Required(CONF_NAME, default="My BMW")] = TextSelector()

        if user_input is not None:
            self._vehicle_name = entry.title if entry else user_input[CONF_NAME].strip()
            if entry is None and not 1 <= len(self._vehicle_name) <= 64:
                errors[CONF_NAME] = "invalid_name"

            origins: dict[str, str] = {}
            for field in (CONF_PUBLIC_URL, CONF_LOCAL_URL):
                if address := user_input.get(field, "").strip():
                    try:
                        origins[field] = _origin(
                            address, require_https=field == CONF_PUBLIC_URL
                        )
                    except ValueError:
                        errors[field] = (
                            "invalid_public_url" if field == CONF_PUBLIC_URL else "invalid_local_url"
                        )
            if not errors:
                origin = (
                    origins.get(CONF_PUBLIC_URL)
                    or origins.get(CONF_LOCAL_URL)
                    or self._local_origin()
                )
                if origin:
                    webhook_id = (
                        entry.data[CONF_WEBHOOK_ID]
                        if entry else webhook.async_generate_id()
                    )
                    self._data = {CONF_WEBHOOK_ID: webhook_id, **origins}
                    self._pair_url = f"{origin}{webhook.async_generate_path(webhook_id)}"
                    return self._show_pair_form()
                errors[CONF_LOCAL_URL] = "missing_local_url"

        return self.async_show_form(
            step_id=step,
            data_schema=self.add_suggested_values_to_schema(
                vol.Schema(schema), user_input if user_input is not None else previous
            ),
            errors=errors,
        )

    async def async_step_pair(self, user_input: dict | None = None) -> ConfigFlowResult:
        if not self._data:
            return self.async_abort(reason="pairing_not_started")
        if user_input is None:
            return self._show_pair_form()
        if self.source == SOURCE_RECONFIGURE:
            return self.async_update_reload_and_abort(
                self._get_reconfigure_entry(),
                data=self._data,
                reload_even_if_entry_is_unchanged=False,
            )
        return self.async_create_entry(title=self._vehicle_name, data=self._data)

    def _show_pair_form(self) -> ConfigFlowResult:
        return self.async_show_form(
            step_id="pair",
            data_schema=vol.Schema({}),
            description_placeholders={"webhook_url": self._pair_url},
        )

    def _local_origin(self) -> str | None:
        try:
            return _origin(get_url(self.hass, allow_external=False, allow_cloud=False))
        except (NoURLAvailableError, ValueError):
            return None
