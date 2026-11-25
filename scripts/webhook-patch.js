// Installed by bmw-linker-ha-setup before the widget starts.
{
  const pushVehicleState = async (snapshot, webhookUrl) => {
    if (!isHaWebhookUrl(webhookUrl)) {
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
      const request = new Request(webhookUrl);
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

  const webhookKey = "bmw-linker-ha.webhook-url." + Script.name();
  const menuName = "bmwLinkerHaWebhook";
  const readWebhook = () => Keychain.contains(webhookKey) ? Keychain.get(webhookKey) : "";
  const webhookStatus = () => readWebhook() ? "已设置" : "未设置";

  Widget = class extends Widget {
    async getAppViewOptions() {
      const options = await super.getAppViewOptions();
      return {
        ...options,
        settingItems: [
          {
            name: menuName,
            label: "Home Assistant Webhook",
            type: "cell",
            icon: { name: "house.fill", color: "#1699cb" },
            needLoading: true,
            desc: webhookStatus(),
          },
          ...options.settingItems,
        ],
        onItemClick: async (item, ...args) => {
          if (item.name !== menuName) return options.onItemClick(item, ...args);

          const alert = new Alert();
          alert.title = "Home Assistant Webhook";
          alert.message = "粘贴 HA 集成生成的完整 Webhook URL。清空后保存可停用推送。";
          alert.addSecureTextField("Webhook URL", readWebhook());
          alert.addAction("保存");
          alert.addCancelAction("取消");
          if (await alert.presentAlert() === 0) {
            const url = alert.textFieldValue(0).trim();
            if (!url) {
              if (Keychain.contains(webhookKey)) Keychain.remove(webhookKey);
            } else if (isHaWebhookUrl(url)) {
              Keychain.set(webhookKey, url);
            } else {
              await this.generateAlert("地址有误", "请粘贴 HA 集成显示的完整 Webhook URL。", ["确定"]);
            }
          }
          return { desc: { value: webhookStatus() } };
        },
      };
    }

    async getData(forceRefresh = false) {
      const data = await super.getData(forceRefresh);
      if (!forceRefresh && data?.properties && !data.black) {
        const url = readWebhook();
        if (url) await pushVehicleState(data.properties, url);
      }
      return data;
    }
  };
}
