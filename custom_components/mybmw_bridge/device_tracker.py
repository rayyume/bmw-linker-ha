"""Display the vehicle's last reported location on the Home Assistant map."""

from math import cos, pi, sin, sqrt

from homeassistant.components.device_tracker import TrackerEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import MyBmwBridgeConfigEntry
from .entity import BridgeEntity
from .snapshot import VehicleSnapshot


def _gcj02_offset(latitude: float, longitude: float) -> tuple[float, float]:
    """Calculate the GCJ-02 offset at a mainland China coordinate."""
    x, y = longitude - 105, latitude - 35
    wave = (20 * sin(6 * x * pi) + 20 * sin(2 * x * pi)) * 2 / 3
    lat_offset = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * sqrt(abs(x))
    lat_offset += wave + (20 * sin(y * pi) + 40 * sin(y * pi / 3)) * 2 / 3
    lat_offset += (160 * sin(y * pi / 12) + 320 * sin(y * pi / 30)) * 2 / 3
    lon_offset = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * sqrt(abs(x))
    lon_offset += wave + (20 * sin(x * pi) + 40 * sin(x * pi / 3)) * 2 / 3
    lon_offset += (150 * sin(x * pi / 12) + 300 * sin(x * pi / 30)) * 2 / 3

    axis = 6378245.0
    eccentricity = 0.006693421622965943
    latitude_radians = latitude * pi / 180
    magic = 1 - eccentricity * sin(latitude_radians) ** 2
    return (
        lat_offset * 180 / (axis * (1 - eccentricity) / (magic * sqrt(magic)) * pi),
        lon_offset * 180 / (axis / sqrt(magic) * cos(latitude_radians) * pi),
    )


def map_position(snapshot: VehicleSnapshot | None) -> tuple[float | None, float | None]:
    """Convert the Chinese widget's Gaode coordinates for the HA map."""
    if snapshot is None:
        return None, None
    latitude = snapshot.values.get("latitude")
    longitude = snapshot.values.get("longitude")
    if type(latitude) not in (float, int) or type(longitude) not in (float, int):
        return None, None

    location = snapshot.state["location"]
    system = location["coordinates"].get("coordinateSystem") or location.get("coordinateSystem")
    if system and str(system).lower().replace("-", "").replace("_", "") != "gcj02":
        return latitude, longitude
    if not (0.8293 <= latitude <= 55.8271 and 72.004 <= longitude <= 137.8347):
        return latitude, longitude

    converted_lat, converted_lon = latitude, longitude
    for _ in range(2):
        lat_offset, lon_offset = _gcj02_offset(converted_lat, converted_lon)
        converted_lat, converted_lon = latitude - lat_offset, longitude - lon_offset
    return round(converted_lat, 7), round(converted_lon, 7)


async def async_setup_entry(
    hass: HomeAssistant, entry: MyBmwBridgeConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([VehiclePosition(entry)])


class VehiclePosition(BridgeEntity, TrackerEntity):
    _attr_translation_key = "position"

    def __init__(self, entry: MyBmwBridgeConfigEntry) -> None:
        super().__init__(entry, "position")

    @property
    def latitude(self) -> float | None:
        return map_position(self.coordinator.data)[0]

    @property
    def longitude(self) -> float | None:
        return map_position(self.coordinator.data)[1]

    @property
    def location_accuracy(self) -> int:
        snapshot = self.coordinator.data
        accuracy = snapshot.values.get("location_accuracy") if snapshot else None
        return round(accuracy) if type(accuracy) in (int, float) else 0
