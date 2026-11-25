# bmw-linker-ha

把没带伞的中国区 `bmw-linker` 已经读到的车辆状态推送给 Home Assistant。HA 会生成一台 BMW 设备和对应实体，包括油量、电量、续航、里程、车锁状态、车辆上报时间和数据过期提示。字段以车辆实际返回为准。原脚本继续负责 BMW 登录和刷新，桥接只向 HA 发送上述状态。

## 安装 Home Assistant 集成

[![在 Home Assistant 安装 bmw-linker-ha](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=rayyume&repository=bmw-linker-ha&category=integration)

- **HACS**：打开 **HACS → ⋮ → 自定义仓库**，填入 `https://github.com/rayyume/bmw-linker-ha`，类型选 **集成**，添加后下载 **bmw-linker-ha**。
- **Home Assistant 2026.11 及以后**：打开 **设置 → Marketplace → 从链接添加**，填入同一个仓库地址，添加后安装 **bmw-linker-ha**。

安装后重启 Home Assistant。在 **设置 → 设备与服务 → 添加集成** 中搜索 **bmw-linker-ha**。

## 选择 Webhook 地址

1. **优先填公网 HTTPS 地址**，例如 `https://ha.example.com`。iPhone 需要能通过蜂窝网络访问该地址。可以使用已有的 HTTPS 反向代理或隧道，家里可以没有公网 IP。反向代理需要按照 HA 的要求配置可信代理，并传递原始 HTTPS 协议。
2. **没有公网地址就留空**。可以填写 iPhone 在同一局域网能访问的地址，例如 `http://192.168.1.20:8123`。都留空时，集成尝试使用 HA 的内部地址。此模式仅接收局域网请求。
3. 下一页会给出完整的 Webhook URL。复制它，再点提交。每次添加车辆会生成单独的 URL。在集成菜单中选择 **重新配置**，可以更新地址并保留 Webhook ID。

地址字段只填协议、主机和可选端口。Webhook 路径由集成生成，请像密码一样保管完整 URL。公网模式只接收 HTTPS POST，局域网模式支持 HTTP 或 HTTPS POST。

## Scriptable 单脚本方式

把发送功能加到你已登录的 BMW 脚本。安装器保留所选脚本的名称和原有小组件绑定。

1. 用 iPhone 打开 [bmw-linker-ha-setup.js](https://raw.githubusercontent.com/rayyume/bmw-linker-ha/main/bmw-linker-ha-setup.js)，全选并复制代码。
2. 打开 Scriptable，点 **＋** 新建脚本，命名为 **bmw-linker-ha-setup**。粘贴整段代码，点 **▶** 运行。选择要安装的脚本。列表会显示以 `bmw-linker` 开头的脚本，同一入口也能**手工输入脚本名**。
3. 返回并运行选中的 BMW 脚本。在原菜单中点 **Home Assistant Webhook**，粘贴 HA 集成显示的完整 URL，再点**保存**。菜单会显示「已设置」。以后从同一入口修改地址，清空后保存即可停用推送。
4. 预览车辆小组件，确认 HA 收到车况。日常由 BMW 脚本负责显示和上报，保留 setup 供以后更新使用。

**原作者更新后**，重新运行 setup 并选择刚更新的脚本。安装器会重新注入 Webhook 菜单和上报代码，同名脚本继续使用钥匙串里原来保存的 URL。对已接入的脚本重复运行不会重复注入。

**多辆车**使用不同的 Scriptable 脚本名，例如 `bmw-linker-i4` 和 `宝马 X5`。在 HA 里分别添加两辆车的集成条目，并在两个脚本中分别填写对应的 Webhook。地址按脚本名保存在 Scriptable 钥匙串里。

<details>
<summary>手动安装和排查</summary>

如果脚本经过其他改动，安装器会保留原文件并提示。手动接入时，移除旧桥接块，再把 [bmw-linker-ha-inline.js](bmw-linker-ha-inline.js) 粘贴到 `await new Widget(Script.name(), {` 的上一行。保存并运行后，可从菜单填入 Webhook。

</details>

## Scriptable 独立发送模块方式

1. 在 iPhone 下载 [bmw-linker-ha-bridge.scriptable](https://github.com/rayyume/bmw-linker-ha/releases/latest/download/bmw-linker-ha-bridge.scriptable)，从“文件”用 Scriptable 打开或分享导入。也可以新建名为 `bmw-linker-ha-bridge` 的脚本，再粘贴 [bmw-linker-ha-bridge.js](bmw-linker-ha-bridge.js) 的内容。打开脚本，把 `HA_WEBHOOK_URL` 的占位值替换成 HA 显示的完整 URL。
2. 打开已经能显示车辆的 `bmw-linker`。在 `render` 方法里找到 `let data = await this.getData();`，在该行**下面**插入以下调用。

   ```js
   if (data?.properties && !data.black) {
     try {
       await importModule("bmw-linker-ha-bridge").pushVehicleState(data.properties);
     } catch {
       console.log("[My BMW HA] 无法调用发送脚本，请检查脚本名称。");
     }
   }
   ```

3. 运行 `bmw-linker` 并打开车辆小组件预览。Scriptable 控制台出现“已更新车辆状态”后，打开 HA 中的 BMW 设备查看实体。使用局域网地址时，若 iOS 提示局域网访问，请允许 Scriptable 访问。

发送脚本由 `bmw-linker` 在拿到车况后调用。此前若已安装内嵌桥接代码或调用过旧的 `scriptable-bridge`，切换时替换旧代码块，避免一次刷新上报两次。

使用 iPhone 信任的 HTTPS 证书，并填写访问 HA 的最终地址。发送脚本遇到重定向会停止请求。

HA 保留最后一次有效上报，重启后恢复。重复或较早的上报不会覆盖已有数据。“车辆数据已过期”在车辆上报时间超过 24 小时后开启，最后已知的数值仍可查看。iOS 的小组件刷新由系统调度。手动跑一次脚本也可能读到 BMW 端的缓存，判断数据是否更新请看“车辆最后上报时间”。

参考 [HACS 自定义仓库](https://www.hacs.xyz/docs/faq/custom_repositories/)、[Home Assistant Marketplace](https://www.home-assistant.io/integrations/marketplace/#custom-repositories)、[Home Assistant Webhook](https://www.home-assistant.io/triggers/webhook/) 和 [Scriptable importModule](https://scriptable.app/docs/reference/importmodule/)。
