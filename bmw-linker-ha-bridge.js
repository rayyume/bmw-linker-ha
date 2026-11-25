// Save this script as "bmw-linker-ha-bridge" in Scriptable.
const HA_WEBHOOK_URL = "PASTE_YOUR_LOCAL_HOME_ASSISTANT_WEBHOOK_URL_HERE";

module.exports.pushVehicleState = async (snapshot) => {
  if (!isHaWebhookUrl(HA_WEBHOOK_URL)) {
    console.log("[My BMW HA] 请填写集成显示的完整 Webhook URL。");
    return;
  }

  const rawTimestamp = snapshot?.lastUpdatedAt;
  const reportedAt = rawTimestamp ? new Date(rawTimestamp) : null;
  if (!reportedAt || !Number.isFinite(reportedAt.getTime())) {
    console.log("[My BMW HA] 车辆数据缺少有效的上报时间。");
    return;
  }

  const fuel = snapshot.combustionFuelLevel;
  const electric = snapshot.electricChargingState;
  const security = snapshot.doorsState?.combinedSecurityState;
  const doorState = {
    LOCKED: "LOCKED",
    SECURED: "LOCKED",
    UNLOCKED: "UNLOCKED",
    SELECTIVE_LOCKED: "UNLOCKED",
    PARTIALLY_LOCKED: "UNLOCKED",
  }[security];

  try {
    const request = new Request(HA_WEBHOOK_URL);
    request.method = "POST";
    request.headers = { "Content-Type": "application/json" };
    request.timeoutInterval = 4;
    request.onRedirect = () => null;
    request.body = JSON.stringify({
      version: 1,
      reported_at: reportedAt.toISOString(),
      battery_percent: nonnegativeNumber(electric?.chargingLevelPercent),
      fuel_percent: nonnegativeNumber(fuel?.remainingFuelPercent),
      fuel_range_km: nonnegativeNumber(fuel?.range),
      electric_range_km: nonnegativeNumber(electric?.range),
      odometer_km: nonnegativeNumber(snapshot.currentMileage),
      door_state: doorState,
    });

    const receipt = await request.loadJSON();
    if (request.response.statusCode !== 200) throw new Error();
    if (receipt?.mybmw_bridge === "updated") {
      console.log("[My BMW HA] 已更新车辆状态。");
    } else if (receipt?.mybmw_bridge === "unchanged") {
      console.log("[My BMW HA] 已收到，车辆上报时间没有更新。");
    } else {
      throw new Error();
    }
  } catch {
    console.log("[My BMW HA] 未收到确认，请检查网络、Webhook 地址和车辆数据。");
  }
};

function isHaWebhookUrl(value) {
  return /^https?:\/\/[^\s/?#@\\]+\/api\/webhook\/[a-f0-9]{64}$/.test(value);
}

function nonnegativeNumber(value) {
  if (typeof value === "string" && value.trim() !== "") value = Number(value);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}
