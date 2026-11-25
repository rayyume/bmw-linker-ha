# bmw-linker-ha

把没带伞的中国区 `bmw-linker` 已经读到的车辆状态推送给 Home Assistant。HA 会生成一台 BMW 设备和对应实体，包括油量、电量、续航、里程、车锁状态、车辆上报时间和数据过期提示。字段以车辆实际返回为准。原脚本继续负责 BMW 登录和刷新，桥接只向 HA 发送上述状态。

## 安装 HA 集成

1. 将本项目 [custom_components/mybmw_bridge](custom_components/mybmw_bridge) 目录复制到 Home Assistant 的 `/config/custom_components/` 下，重启 HA。
2. 打开 **设置 → 设备与服务 → 添加集成**，搜索 **My BMW Scriptable Bridge**。
3. 复制配置窗口显示的 `/api/webhook/…` 路径。把它接到 iPhone 在同一局域网内能访问的 HA 地址后面，例如 `http://192.168.1.20:8123/api/webhook/…`。提交配置。需要重新查看路径时，在集成的菜单中选择 **重新配置**。

## 添加独立的 Scriptable 发送脚本

1. 在 iPhone 的 Scriptable 中新建脚本，命名为 `scriptable-bridge`。把本项目 [scriptable-bridge.js](scriptable-bridge.js) 的内容粘贴进去，将 `HA_WEBHOOK_URL` 换成完整的局域网 Webhook 地址。
2. 打开已经能显示车辆的 `bmw-linker`。在 `render` 方法里找到 `let data = await this.getData();`，在该行**下面**插入以下调用。

   ```js
   if (data?.properties && !data.black) {
     try {
       await importModule("scriptable-bridge").pushVehicleState(data.properties);
     } catch {
       console.log("[My BMW HA] 无法调用发送脚本，请检查脚本名称。");
     }
   }
   ```

3. 在同一局域网运行 `bmw-linker` 并打开车辆小组件预览。Scriptable 控制台出现“已更新车辆状态”后，打开 HA 中的 BMW 设备查看实体。iOS 弹出局域网访问提示时，允许 Scriptable 访问。

发送脚本由 `bmw-linker` 在拿到车况后调用。此前若已安装整段内嵌桥接代码，切换时删除旧代码块，避免一次刷新上报两次。

每个 Webhook 对应一辆车。把 Webhook 当作密码保管，仅填写实际 HA 局域网地址。HA 端只接受局域网 POST，手机端遇到重定向会停止发送。如果 HA 使用 HTTPS，使用 iPhone 信任的证书。

HA 保留最后一次有效上报，重启后恢复。重复或较早的上报不会覆盖已有数据。“车辆数据已过期”在车辆上报时间超过 24 小时后开启，最后已知的数值仍可查看。iOS 的小组件刷新由系统调度。手动跑一次脚本也可能读到 BMW 端的缓存，判断数据是否更新请看“车辆最后上报时间”。

参考 [Home Assistant Webhook](https://www.home-assistant.io/triggers/webhook/)、[Scriptable importModule](https://scriptable.app/docs/reference/importmodule/) 和 [Scriptable Request API](https://scriptable.app/docs/reference/request/)。
