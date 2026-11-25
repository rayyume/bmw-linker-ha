"""Validate and persist a vehicle image uploaded by Scriptable."""

from base64 import b64decode, b64encode
from dataclasses import dataclass
from datetime import datetime
import struct

MAX_PHOTO_BYTES = 1024 * 1024
_PNG_HEADER = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR"
_PNG_END = b"\x00\x00\x00\x00IEND\xaeB`\x82"


@dataclass(frozen=True)
class VehiclePhoto:
    vin: str
    data: bytes
    updated_at: datetime

    @classmethod
    def from_png(cls, vin: str, data: bytes, updated_at: datetime) -> "VehiclePhoto":
        if (
            len(data) < 45
            or len(data) > MAX_PHOTO_BYTES
            or not data.startswith(_PNG_HEADER)
            or not data.endswith(_PNG_END)
        ):
            raise ValueError("invalid_vehicle_photo")
        width, height = struct.unpack_from(">II", data, len(_PNG_HEADER))
        if not (1 <= width <= 900 and 1 <= height <= 900):
            raise ValueError("invalid_vehicle_photo_dimensions")
        return cls(vin, data, updated_at)

    @classmethod
    def from_storage(cls, stored: dict) -> "VehiclePhoto":
        return cls.from_png(
            stored["vin"],
            b64decode(stored["image"], validate=True),
            datetime.fromisoformat(stored["updated_at"]),
        )

    def as_storage_data(self) -> dict:
        return {
            "vin": self.vin,
            "image": b64encode(self.data).decode("ascii"),
            "updated_at": self.updated_at.isoformat(),
        }
