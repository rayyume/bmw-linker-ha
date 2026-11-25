const bridgeCode = /* generated bridge */ null;
const startup = "await new Widget(Script.name(), {";
const configuredMenu = 'const menuName = "bmwLinkerHaWebhook";';

function findOriginalScript() {
  const local = FileManager.local();
  const fileName = "bmw-linker.js";
  const sibling = module.filename.replace(/[^/]+$/, fileName);
  if (sibling !== module.filename && local.fileExists(sibling)) {
    const manager = local.isFileStoredIniCloud(sibling) ? FileManager.iCloud() : local;
    return { manager, path: sibling };
  }

  const candidates = [{ manager: local, path: local.joinPath(local.documentsDirectory(), fileName) }];
  try {
    const cloud = FileManager.iCloud();
    const path = cloud.joinPath(cloud.documentsDirectory(), fileName);
    if (path !== candidates[0].path) candidates.push({ manager: cloud, path });
  } catch {
    // The device may have iCloud Drive disabled.
  }

  const found = candidates.filter(({ manager, path }) => manager.fileExists(path));
  if (found.length > 1) {
    throw new Error("本机和 iCloud 都有 bmw-linker。请把安装脚本放到你使用的 bmw-linker 所在位置。");
  }
  if (found.length === 0) {
    throw new Error("找不到名为 bmw-linker 的脚本。请确认原脚本已导入 Scriptable，且名称为 bmw-linker。");
  }
  return found[0];
}

function addBridge(original) {
  if (original.includes(configuredMenu)) return original;

  // Remove the exact module call from the previous installation guide.
  const oldModuleCall = /^([ \t]*let data = await this\.getData\(\);\r?\n)[ \t]*if \(data\?\.properties && !data\.black\) \{\r?\n[ \t]*try \{\r?\n[ \t]*await importModule\("(?:bmw-linker-ha-bridge|scriptable-bridge)"\)\.pushVehicleState\(data\.properties\);\r?\n[ \t]*\} catch \{\r?\n[ \t]*console\.log\("\[My BMW HA\] 无法调用发送脚本，请检查脚本名称。"\);\r?\n[ \t]*\}\r?\n[ \t]*\}\r?\n/m;
  const updated = original.replace(oldModuleCall, "$1");
  if (/pushVehicleState|HA_WEBHOOK_URL|\[My BMW HA\]/.test(updated)) {
    throw new Error("检测到其他版本的桥接代码。安装器已保留原脚本，请先用未加桥接的 bmw-linker 运行安装。");
  }
  if (updated.split(startup).length !== 2 || !updated.includes("async getAppViewOptions()")) {
    throw new Error("这个 bmw-linker 版本的入口与安装器不匹配，原脚本已保留。");
  }

  const lineEnding = updated.includes("\r\n") ? "\r\n" : "\n";
  const patch = bridgeCode.replace(/\n/g, lineEnding);
  return updated.replace(startup, () => patch + lineEnding + startup);
}

async function installBridge() {
  const { manager, path } = findOriginalScript();
  if (manager.isFileStoredIniCloud(path)) await manager.downloadFileFromiCloud(path);
  const original = manager.readString(path);
  const updated = addBridge(original);
  if (updated === original) return "已经装好。请打开 bmw-linker，在菜单中选择 Home Assistant Webhook。";

  const local = FileManager.local();
  const backups = local.joinPath(local.documentsDirectory(), "bmw-linker-ha-backups");
  if (!local.fileExists(backups)) local.createDirectory(backups);
  const backupName = "bmw-linker-" + new Date().toISOString().replace(/[:.]/g, "-") + ".js.bak";
  const backup = local.joinPath(backups, backupName);
  local.writeString(backup, original);
  if (local.readString(backup) !== original) {
    throw new Error("备份校验失败，原脚本已保留。");
  }

  if (manager.readString(path) !== original) {
    throw new Error("安装期间 bmw-linker 内容发生变化，请关闭编辑器后重试。");
  }
  try {
    manager.writeString(path, updated);
    if (manager.readString(path) !== updated) throw new Error("安装校验失败");
  } catch {
    try {
      manager.writeString(path, original);
      if (manager.readString(path) !== original) throw new Error("恢复校验失败");
    } catch {
      throw new Error("写入和自动恢复失败。原代码保存在 bmw-linker-ha-backups/" + backupName + "。");
    }
    throw new Error("安装未完成，原脚本已恢复。");
  }

  return "已更新原来的 bmw-linker。请返回脚本列表，运行 bmw-linker，在 Home Assistant Webhook 菜单中填写地址。";
}

const result = new Alert();
try {
  result.title = "安装完成";
  result.message = await installBridge();
} catch (error) {
  result.title = "安装未完成";
  result.message = error.message;
}
result.addAction("确定");
await result.presentAlert();
