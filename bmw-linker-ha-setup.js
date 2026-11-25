const bridgeCode = "// BEGIN bmw-linker-ha bridge\n{\n  const privateFields = new Set([\n    \"accesstoken\", \"refreshtoken\", \"idtoken\", \"token\", \"password\", \"encryptedpassword\",\n    \"authorization\", \"cookie\", \"cookies\", \"gcid\", \"accountid\", \"userid\", \"phonenumber\",\n    \"phone\", \"email\", \"otp\", \"otpcode\", \"clientsecret\", \"apikey\", \"privatekey\",\n    \"digitalkey\", \"credential\", \"credentials\",\n  ]);\n\n  function vehicleFields(key, value) {\n    if (privateFields.has(key.toLowerCase().replace(/[^a-z]/g, \"\"))) return undefined;\n    if (typeof value === \"string\" &&\n      (/^data:/i.test(value) || /[?&](?:access_token|refresh_token|id_token|token|api_key|key)=/i.test(value))) {\n      return undefined;\n    }\n    return value;\n  }\n\n  const pushVehicleState = async (snapshot, trips, webhookUrl) => {\n    if (!isHaWebhookUrl(webhookUrl)) {\n      console.log(\"[My BMW HA] 请填写集成显示的完整 Webhook URL。\");\n      return;\n    }\n\n    const { properties: state, black, ...vehicle } = snapshot;\n    const rawTimestamp = state.lastUpdatedAt;\n    const reportedAt = rawTimestamp ? new Date(rawTimestamp) : null;\n    if (!reportedAt || !Number.isFinite(reportedAt.getTime())) {\n      console.log(\"[My BMW HA] 车辆数据缺少有效的上报时间。\");\n      return;\n    }\n\n    try {\n      const request = new Request(webhookUrl);\n      request.method = \"POST\";\n      request.headers = { \"Content-Type\": \"application/json\" };\n      request.timeoutInterval = 4;\n      request.onRedirect = () => null;\n      request.body = JSON.stringify({\n        version: 2,\n        reported_at: reportedAt.toISOString(),\n        vehicle,\n        state,\n        trips,\n      }, vehicleFields);\n\n      const receipt = await request.loadJSON();\n      if (request.response.statusCode !== 200) throw new Error();\n      if (receipt?.mybmw_bridge === \"updated\") {\n        console.log(\"[My BMW HA] 已更新车辆状态。\");\n      } else if (receipt?.mybmw_bridge === \"unchanged\") {\n        console.log(\"[My BMW HA] 已收到，车辆数据没有更新。\");\n      } else {\n        throw new Error();\n      }\n    } catch {\n      console.log(\"[My BMW HA] 未收到确认，请检查网络、Webhook 地址和车辆数据。\");\n    }\n  };\n\n  function isHaWebhookUrl(value) {\n    return /^https?:\\/\\/[^\\s/?#@\\\\]+\\/api\\/webhook\\/[a-f0-9]{64}$/.test(value);\n  }\n\n  const webhookKey = \"bmw-linker-ha.webhook-url.\" + Script.name();\n  const photoKey = \"bmw-linker-ha.photo-receipt.\" + Script.name();\n  const menuName = \"bmwLinkerHaWebhook\";\n  const maxPhotoBase64Length = 1398104; // Base64 length of the HA endpoint's 1 MiB limit.\n  const readWebhook = () => Keychain.contains(webhookKey) ? Keychain.get(webhookKey) : \"\";\n  const webhookStatus = () => readWebhook() ? \"已设置\" : \"未设置\";\n\n  function resizePhoto(image, maxDimension) {\n    const { width, height } = image.size;\n    const scale = Math.min(1, maxDimension / Math.max(width, height));\n    const targetWidth = Math.max(1, Math.round(width * scale));\n    const targetHeight = Math.max(1, Math.round(height * scale));\n    const canvas = new DrawContext();\n    canvas.size = new Size(targetWidth, targetHeight);\n    canvas.opaque = false;\n    canvas.respectScreenScale = false;\n    canvas.drawImageInRect(image, new Rect(0, 0, targetWidth, targetHeight));\n    return Data.fromPNG(canvas.getImage());\n  }\n\n  Widget = class extends Widget {\n    async getAppViewOptions() {\n      const options = await super.getAppViewOptions();\n      return {\n        ...options,\n        settingItems: [\n          {\n            name: menuName,\n            label: \"Home Assistant Webhook\",\n            type: \"cell\",\n            icon: { name: \"house.fill\", color: \"#1699cb\" },\n            needLoading: true,\n            desc: webhookStatus(),\n          },\n          ...options.settingItems,\n        ],\n        onItemClick: async (item, ...args) => {\n          if (item.name !== menuName) return options.onItemClick(item, ...args);\n\n          const alert = new Alert();\n          alert.title = \"Home Assistant Webhook\";\n          alert.message = \"粘贴 HA 集成生成的完整 Webhook URL。清空后保存可停用推送。\";\n          alert.addSecureTextField(\"Webhook URL\", readWebhook());\n          alert.addAction(\"保存\");\n          alert.addCancelAction(\"取消\");\n          if (await alert.presentAlert() === 0) {\n            const url = alert.textFieldValue(0).trim();\n            if (!url) {\n              if (Keychain.contains(webhookKey)) Keychain.remove(webhookKey);\n            } else if (isHaWebhookUrl(url)) {\n              Keychain.set(webhookKey, url);\n            } else {\n              await this.generateAlert(\"地址有误\", \"请粘贴 HA 集成显示的完整 Webhook URL。\", [\"确定\"]);\n            }\n          }\n          return { desc: { value: webhookStatus() } };\n        },\n      };\n    }\n\n    async getData(forceRefresh = false) {\n      const data = await super.getData(forceRefresh);\n      if (!forceRefresh && data?.properties && !data.black) {\n        const url = readWebhook();\n        if (url) {\n          const trip = this.myBmwHaTrip;\n          const display = {};\n          try {\n            display.name = this.custom_name?.() || undefined;\n            display.licensePlate = this.licensePlate?.() || undefined;\n            display.fuelTankLiters = this.totalFuelLiters?.() || undefined;\n          } catch {\n            // Some versions have different widget preferences.\n          }\n          await pushVehicleState({ ...data, scriptableDisplay: display }, trip?.vin === data.vin ? trip?.report : undefined, url);\n        }\n      }\n      return data;\n    }\n\n    async sustainability(...args) {\n      const vin = args[1];\n      const lastRefresh = this.keyGet(\"VIN_sustainabilityTime\");\n      const result = await super.sustainability(...args);\n      // The upstream cache key has no VIN. Associate the report only when this call refreshes it.\n      if (typeof vin === \"string\" && this.keyGet(\"VIN_sustainabilityTime\") !== lastRefresh) {\n        try {\n          const report = JSON.parse(this.keyGet(\"VIN_sustainabilityres\"));\n          if (report?.status === \"Success\") this.myBmwHaTrip = { vin, report };\n        } catch {\n          // The upstream cache may be unavailable. Vehicle state can still be sent.\n        }\n      }\n      return result;\n    }\n\n    async getVehicleImage(vehicle) {\n      const image = await super.getVehicleImage(vehicle);\n      const vin = vehicle?.vin;\n      const url = readWebhook();\n      if (!image?.size || typeof vin !== \"string\" || vehicle.black || !isHaWebhookUrl(url)) return image;\n\n      try {\n        let photo = resizePhoto(image, 820);\n        let encoded = photo.toBase64String();\n        if (encoded.length > maxPhotoBase64Length) {\n          photo = resizePhoto(image, 500);\n          encoded = photo.toBase64String();\n        }\n        if (encoded.length > maxPhotoBase64Length) return image;\n\n        const signature = this.md5(url + \"\\n\" + vin + \"\\n\" + encoded);\n        const [previousSignature, sentAt] = (Keychain.contains(photoKey) ? Keychain.get(photoKey) : \"\").split(\"|\");\n        if (signature === previousSignature && Date.now() - Number(sentAt) < 86400000) return image;\n\n        const request = new Request(url);\n        request.method = \"POST\";\n        request.headers = { \"Content-Type\": \"image/png\", \"X-BMW-VIN\": vin };\n        request.timeoutInterval = 4;\n        request.onRedirect = () => null;\n        request.body = photo;\n        const receipt = await request.loadJSON();\n        if (request.response.statusCode === 200 &&\n            [\"photo_updated\", \"photo_unchanged\"].includes(receipt?.mybmw_bridge)) {\n          Keychain.set(photoKey, signature + \"|\" + Date.now());\n        } else {\n          console.log(\"[My BMW HA] 车型图尚未被 HA 接收，后续预览时会重试。\");\n        }\n      } catch {\n        console.log(\"[My BMW HA] 车型图同步未完成，后续预览时会重试。\");\n      }\n      return image;\n    }\n  };\n}\n// END bmw-linker-ha bridge\n";
const configuredMenu = 'const menuName = "bmwLinkerHaWebhook";';

function scriptFolders() {
  const local = FileManager.local();
  const folders = [{ manager: local, path: local.documentsDirectory() }];
  let cloud;
  try {
    cloud = FileManager.iCloud();
    const cloudPath = cloud.documentsDirectory();
    if (cloudPath) folders.push({ manager: cloud, path: cloudPath });
  } catch {
    // The device may have iCloud Drive disabled.
  }

  const scriptDirectory = module.filename.slice(0, module.filename.lastIndexOf("/"));
  if (scriptDirectory) {
    const manager = cloud && local.isFileStoredIniCloud(module.filename) ? cloud : local;
    folders.unshift({ manager, path: scriptDirectory });
  }
  const unique = new Map();
  for (const folder of folders) {
    const key = folder.path.replace(/^\/private(?=\/var\/)/, "").replace(/\/+$/, "");
    if (!unique.has(key)) unique.set(key, folder);
  }
  return [...unique.values()];
}

function locateScript(name, folders) {
  const found = folders
    .map(({ manager, path }) => ({ manager, path: manager.joinPath(path, name + ".js") }))
    .filter(({ manager, path }) =>
      path !== module.filename && manager.fileExists(path) && !manager.isDirectory(path));
  if (found.length === 0) {
    throw new Error("找不到「" + name + "」。请输入 Scriptable 中显示的完整脚本名称。");
  }
  if (found.length > 1) {
    throw new Error("发现多份同名脚本「" + name + "」。请先给不同车辆的脚本设置不同名称。");
  }
  return { name, ...found[0] };
}

async function chooseScript() {
  const folders = scriptFolders();
  const helperNames = new Set(["bmw-linker-ha-setup", "bmw-linker-ha-bridge", "bmw-linker-ha-inline"]);
  const names = new Set();
  for (const { manager, path } of folders) {
    let files;
    try {
      if (!manager.fileExists(path)) continue;
      files = manager.listContents(path);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!/^bmw-linker.*\.js$/i.test(file)) continue;
      const name = file.slice(0, -3);
      const filePath = manager.joinPath(path, file);
      if (
        !helperNames.has(name.toLowerCase()) &&
        filePath !== module.filename &&
        !manager.isDirectory(filePath)
      ) {
        names.add(name);
      }
    }
  }

  const suggested = [...names].sort((left, right) => left.localeCompare(right));
  const chooser = new Alert();
  chooser.title = "选择要安装或恢复桥接的脚本";
  for (const name of suggested) chooser.addAction(name);
  chooser.addAction("手工输入脚本名");
  chooser.addCancelAction("取消");
  const action = await chooser.presentSheet();
  if (action < 0) return null;
  if (action < suggested.length) return locateScript(suggested[action], folders);

  const prompt = new Alert();
  prompt.title = "输入 Scriptable 脚本名称";
  prompt.addTextField("例如 宝马 i4");
  prompt.addAction("继续");
  prompt.addCancelAction("取消");
  if (await prompt.presentAlert() !== 0) return null;
  const name = prompt.textFieldValue(0).trim().replace(/\.js$/i, "");
  if (!name || /[/\\\u0000-\u001f]/.test(name) || helperNames.has(name.toLowerCase())) {
    throw new Error("请输入 BMW 脚本名称，填写 Scriptable 列表里显示的名称即可。");
  }
  return locateScript(name, folders);
}

function addBridge(original) {
  // Remove the exact module call from the previous installation guide.
  const oldModuleCall = /^([ \t]*let data = await this\.getData\(\);\r?\n)[ \t]*if \(data\?\.properties && !data\.black\) \{\r?\n[ \t]*try \{\r?\n[ \t]*await importModule\("(?:bmw-linker-ha-bridge|scriptable-bridge)"\)\.pushVehicleState\(data\.properties\);\r?\n[ \t]*\} catch \{\r?\n[ \t]*console\.log\("\[My BMW HA\] 无法调用发送脚本，请检查脚本名称。"\);\r?\n[ \t]*\}\r?\n[ \t]*\}\r?\n/m;
  let updated = original.replace(oldModuleCall, "$1");
  const startups = [...updated.matchAll(/^[ \t]*await\s+new\s+Widget\s*\(\s*Script\.name\s*\(\s*\)\s*,\s*\{/gm)];
  if (
    startups.length !== 1 ||
    !/\bclass\s+Widget\s+extends\s+BaseWidget\b/.test(updated) ||
    !/\basync\s+getAppViewOptions\s*\(/.test(updated) ||
    !/\basync\s+getData\s*\(/.test(updated)
  ) {
    throw new Error("这个 bmw-linker 版本的入口与安装器不匹配，原脚本已保留。");
  }

  const lineEnding = updated.includes("\r\n") ? "\r\n" : "\n";
  const patch = bridgeCode.replace(/\n/g, lineEnding);
  let { index } = startups[0];
  const beforeStartup = updated.slice(0, index);
  if (updated.includes(configuredMenu)) {
    const managed = [...beforeStartup.matchAll(
      /^\/\/ BEGIN bmw-linker-ha bridge\r?\n[\s\S]*?^\/\/ END bmw-linker-ha bridge\r?\n\r?\n?/gm,
    )];
    const legacyStarts = [...beforeStartup.matchAll(
      /^\/\/ (?:Installed by bmw-linker-ha-setup before the widget starts\.|Generated by scripts\/build-inline-bridge\.mjs\.)\r?$/gm,
    )];
    if (managed.length === 1 && legacyStarts.length === 0 && managed[0][0].includes(configuredMenu)) {
      const { index: start } = managed[0];
      return updated.slice(0, start) + patch + lineEnding + updated.slice(start + managed[0][0].length);
    }
    if (managed.length === 0 && legacyStarts.length === 1) {
      const { index: start } = legacyStarts[0];
      const legacy = beforeStartup.slice(start);
      if (legacy.includes(configuredMenu) && /\n      return data;\r?\n    \}\r?\n  \};\r?\n\}\s*$/.test(legacy)) {
        updated = updated.slice(0, start) + updated.slice(index);
        index = start;
      }
    }
  }
  if (/pushVehicleState|HA_WEBHOOK_URL|\[My BMW HA\]|bmwLinkerHaWebhook/.test(updated)) {
    throw new Error("检测到其他版本的桥接代码。安装器已保留原脚本，请先用未加桥接的 bmw-linker 运行安装。");
  }
  return updated.slice(0, index) + patch + lineEnding + updated.slice(index);
}

async function installBridge() {
  const script = await chooseScript();
  if (!script) return;
  const { manager, name, path } = script;
  if (manager.isFileStoredIniCloud(path)) await manager.downloadFileFromiCloud(path);
  const original = manager.readString(path);
  const updated = addBridge(original);
  if (updated === original) return "「" + name + "」已安装桥接。";

  if (manager.readString(path) !== original) {
    throw new Error("安装期间所选脚本内容发生变化，请关闭编辑器后重试。");
  }
  try {
    manager.writeString(path, updated);
    if (manager.readString(path) !== updated) throw new Error("安装校验失败");
  } catch {
    try {
      manager.writeString(path, original);
      if (manager.readString(path) !== original) throw new Error("恢复校验失败");
    } catch {
      throw new Error("写入和自动恢复失败，请重新导入原来的「" + name + "」。");
    }
    throw new Error("安装未完成，原脚本已恢复。");
  }

  return "「" + name + "」的桥接已就绪。请运行该脚本。首次安装时，在 Home Assistant Webhook 菜单设置地址；此前保存过的地址可继续使用。";
}

const result = new Alert();
try {
  result.title = "安装完成";
  result.message = await installBridge();
} catch (error) {
  result.title = "安装未完成";
  result.message = error.message;
}
if (result.message) {
  result.addAction("确定");
  await result.presentAlert();
}
