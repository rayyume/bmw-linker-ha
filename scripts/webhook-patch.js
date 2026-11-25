// BEGIN bmw-linker-ha bridge
{
  const privateFields = new Set([
    "accesstoken", "refreshtoken", "idtoken", "token", "password", "encryptedpassword",
    "authorization", "cookie", "cookies", "gcid", "accountid", "userid", "phonenumber",
    "phone", "email", "otp", "otpcode", "clientsecret", "apikey", "privatekey",
    "digitalkey", "credential", "credentials",
  ]);

  function vehicleFields(key, value) {
    if (privateFields.has(key.toLowerCase().replace(/[^a-z]/g, ""))) return undefined;
    if (typeof value === "string" &&
      (/^data:/i.test(value) || /[?&](?:access_token|refresh_token|id_token|token|api_key|key)=/i.test(value))) {
      return undefined;
    }
    return value;
  }

  const pushVehicleState = async (snapshot, trips, webhookUrl) => {
    if (!isHaWebhookUrl(webhookUrl)) {
      console.log("[My BMW HA] 请填写集成显示的完整 Webhook URL。");
      return;
    }

    const { properties: state, black, ...vehicle } = snapshot;
    const rawTimestamp = state.lastUpdatedAt;
    const reportedAt = rawTimestamp ? new Date(rawTimestamp) : null;
    if (!reportedAt || !Number.isFinite(reportedAt.getTime())) {
      console.log("[My BMW HA] 车辆数据缺少有效的上报时间。");
      return;
    }

    try {
      const request = new Request(webhookUrl);
      request.method = "POST";
      request.headers = { "Content-Type": "application/json" };
      request.timeoutInterval = 4;
      request.onRedirect = () => null;
      request.body = JSON.stringify({
        version: 2,
        reported_at: reportedAt.toISOString(),
        vehicle,
        state,
        trips,
      }, vehicleFields);

      const receipt = await request.loadJSON();
      if (request.response.statusCode !== 200) throw new Error();
      if (receipt?.mybmw_bridge === "updated") {
        console.log("[My BMW HA] 已更新车辆状态。");
      } else if (receipt?.mybmw_bridge === "unchanged") {
        console.log("[My BMW HA] 已收到，车辆数据没有更新。");
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

  const webhookKey = "bmw-linker-ha.webhook-url." + Script.name();
  const photoKey = "bmw-linker-ha.photo-receipt." + Script.name();
  const menuName = "bmwLinkerHaWebhook";
  const maxPhotoBase64Length = 1398104; // Base64 length of the HA endpoint's 1 MiB limit.
  const readWebhook = () => Keychain.contains(webhookKey) ? Keychain.get(webhookKey) : "";
  const webhookStatus = () => readWebhook() ? "已设置" : "未设置";

  function resizePhoto(image, maxDimension) {
    const { width, height } = image.size;
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = new DrawContext();
    canvas.size = new Size(targetWidth, targetHeight);
    canvas.opaque = false;
    canvas.respectScreenScale = false;
    canvas.drawImageInRect(image, new Rect(0, 0, targetWidth, targetHeight));
    return Data.fromPNG(canvas.getImage());
  }

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
        if (url) {
          const trip = this.myBmwHaTrip;
          const display = {};
          try {
            display.name = this.custom_name?.() || undefined;
            display.licensePlate = this.licensePlate?.() || undefined;
            display.fuelTankLiters = this.totalFuelLiters?.() || undefined;
          } catch {
            // Some versions have different widget preferences.
          }
          await pushVehicleState({ ...data, scriptableDisplay: display }, trip?.vin === data.vin ? trip?.report : undefined, url);
        }
      }
      return data;
    }

    async sustainability(...args) {
      const vin = args[1];
      const lastRefresh = this.keyGet("VIN_sustainabilityTime");
      const result = await super.sustainability(...args);
      // The upstream cache key has no VIN. Associate the report only when this call refreshes it.
      if (typeof vin === "string" && this.keyGet("VIN_sustainabilityTime") !== lastRefresh) {
        try {
          const report = JSON.parse(this.keyGet("VIN_sustainabilityres"));
          if (report?.status === "Success") this.myBmwHaTrip = { vin, report };
        } catch {
          // The upstream cache may be unavailable. Vehicle state can still be sent.
        }
      }
      return result;
    }

    async getVehicleImage(vehicle) {
      const image = await super.getVehicleImage(vehicle);
      const vin = vehicle?.vin;
      const url = readWebhook();
      if (!image?.size || typeof vin !== "string" || vehicle.black || !isHaWebhookUrl(url)) return image;

      try {
        let photo = resizePhoto(image, 820);
        let encoded = photo.toBase64String();
        if (encoded.length > maxPhotoBase64Length) {
          photo = resizePhoto(image, 500);
          encoded = photo.toBase64String();
        }
        if (encoded.length > maxPhotoBase64Length) return image;

        const signature = this.md5(url + "\n" + vin + "\n" + encoded);
        const [previousSignature, sentAt] = (Keychain.contains(photoKey) ? Keychain.get(photoKey) : "").split("|");
        if (signature === previousSignature && Date.now() - Number(sentAt) < 86400000) return image;

        const request = new Request(url);
        request.method = "POST";
        request.headers = { "Content-Type": "image/png", "X-BMW-VIN": vin };
        request.timeoutInterval = 4;
        request.onRedirect = () => null;
        request.body = photo;
        const receipt = await request.loadJSON();
        if (request.response.statusCode === 200 &&
            ["photo_updated", "photo_unchanged"].includes(receipt?.mybmw_bridge)) {
          Keychain.set(photoKey, signature + "|" + Date.now());
        } else {
          console.log("[My BMW HA] 车型图尚未被 HA 接收，后续预览时会重试。");
        }
      } catch {
        console.log("[My BMW HA] 车型图同步未完成，后续预览时会重试。");
      }
      return image;
    }
  };
}
// END bmw-linker-ha bridge
