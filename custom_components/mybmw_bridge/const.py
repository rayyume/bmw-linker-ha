"""Constants for the My BMW Scriptable Bridge."""

from datetime import timedelta

DOMAIN = "mybmw_bridge"
CONF_LOCAL_URL = "local_url"
CONF_PUBLIC_URL = "public_url"
CONF_WEBHOOK_ID = "webhook_id"
STALE_AFTER = timedelta(hours=24)
