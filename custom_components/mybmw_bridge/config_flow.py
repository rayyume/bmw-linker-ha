"""Set up a local webhook for a Scriptable widget."""

import voluptuous as vol

from homeassistant.components import webhook
from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.const import CONF_NAME
from homeassistant.helpers.selector import TextSelector

from .const import CONF_WEBHOOK_ID, DOMAIN


class MyBmwBridgeConfigFlow(ConfigFlow, domain=DOMAIN):
    """Configure one vehicle per webhook."""

    VERSION = 1

    def __init__(self) -> None:
        self._webhook_id = webhook.async_generate_id()

    async def async_step_user(self, user_input: dict | None = None) -> ConfigFlowResult:
        errors = {}
        if user_input is not None:
            name = user_input[CONF_NAME].strip()
            if 1 <= len(name) <= 64:
                return self.async_create_entry(
                    title=name, data={CONF_WEBHOOK_ID: self._webhook_id}
                )
            errors[CONF_NAME] = "invalid_name"

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({vol.Required(CONF_NAME, default="My BMW"): TextSelector()}),
            errors=errors,
            description_placeholders={
                "webhook_path": webhook.async_generate_path(self._webhook_id)
            },
        )

    async def async_step_reconfigure(
        self, user_input: dict | None = None
    ) -> ConfigFlowResult:
        entry = self._get_reconfigure_entry()
        if user_input is not None:
            return self.async_update_reload_and_abort(entry, reload_even_if_entry_is_unchanged=False)
        return self.async_show_form(
            step_id="reconfigure",
            description_placeholders={
                "webhook_path": webhook.async_generate_path(entry.data[CONF_WEBHOOK_ID])
            },
        )
