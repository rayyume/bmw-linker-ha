# bmw-linker-ha

把没带伞的中国区 `bmw-linker` 已经读到的车辆数据推送给 Home Assistant。原脚本负责 BMW 登录和刷新，HA 接收选中车辆的上报。

## 车辆实体

| 数据 | HA 中的位置 |
| --- | --- |
| 车辆位置 | 经纬度、地址和定位精度传感器，以及可放进 HA 地图的「车辆位置」设备追踪实体 |
| 车辆资料 | 品牌、车型、VIN、车牌 |
| 续航与充电 | 油量、剩余燃油、电量、燃油续航、纯电续航、总里程、充电枪连接、充电状态、充电目标和充电剩余时间 |
| 车况 | 车锁、车门、车窗、天窗、引擎盖、后备箱、四轮实时与目标胎压、车况提醒数量 |
| 行程与能耗 | 最近一次行程和本月的平均油耗与电耗，以及原脚本显示的能耗摘要 |
| 其他车况字段 | 「车辆详情」实体的 `vehicle`、`vehicle_state` 和 `trips` 属性，保留车型资料、车况提醒明细及原脚本已获取的行程与能耗报告 |

可用字段取决于车型和宝马实际返回的数据。详细能耗报告会在原脚本下次刷新行程缓存后上报。集成发送和保存车牌、VIN 和位置，请妥善保管 Webhook URL。

经纬度传感器保留原始值。原脚本直接将中国区坐标用于高德地图，版本 `0.3.0` 的 HA 地图定位在常见中国大陆坐标范围内默认按 GCJ-02 转为 WGS84。若原数据提供了坐标系，集成按该标记处理。[高德坐标系说明](https://lbs.amap.com/faq/advisory/others/39838)

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

## 安装 Scriptable 桥接

把发送功能加到你已登录的 BMW 脚本。安装器保留所选脚本的名称和原有小组件绑定。

1. 用 iPhone 下载 [bmw-linker-ha-setup.scriptable](https://github.com/rayyume/bmw-linker-ha/releases/latest/download/bmw-linker-ha-setup.scriptable)，保存到「文件」App。
2. 在「文件」App 的下载项里找到这个 `.scriptable` 文件，长按后选 **分享 → Scriptable** 导入。
3. 打开 Scriptable，运行 **bmw-linker-ha-setup**，选择要接入的脚本。列表会显示以 `bmw-linker` 开头的脚本，也能**手工输入脚本名**。
4. 打开选中的 BMW 脚本。从原菜单点 **Home Assistant Webhook**，粘贴 HA 集成显示的完整 URL，再点**保存**。预览小组件，确认 HA 收到车况。保留 setup 供以后更新使用。

**备用方式（复制粘贴）**：如果文件的分享菜单没有 Scriptable，打开 [bmw-linker-ha-setup.js](https://raw.githubusercontent.com/rayyume/bmw-linker-ha/main/bmw-linker-ha-setup.js) 并复制全部代码。在 Scriptable 点 **＋**，新建 **bmw-linker-ha-setup**，粘贴代码后从第 3 步继续。如果已有同名 setup，直接替换它的代码。

**从 `0.2.x` 升级**：先在 HACS 更新集成并重启 HA，再导入新版 setup，对每个已接入的 BMW 脚本各运行一次安装器。已有 Webhook 地址会继续使用。预览 BMW 小组件即可发送新字段。

**原作者更新后**，重新运行 setup 并选择刚更新的脚本。安装器会重新注入 Webhook 菜单和上报代码，同名脚本继续使用钥匙串里原来保存的 URL。对已接入的脚本重复运行不会重复注入。

**多辆车**使用不同的 Scriptable 脚本名，例如 `bmw-linker-i4` 和 `宝马 X5`。在 HA 里分别添加两辆车的集成条目，并在两个脚本中分别填写对应的 Webhook。地址按脚本名保存在 Scriptable 钥匙串里。

如果原脚本入口有改动，安装器会提示不匹配并保留原文件。预览时，Scriptable 控制台显示「已更新车辆状态」说明 HA 已接收数据。使用局域网地址时，若 iOS 提示局域网访问，请允许 Scriptable 访问。

使用 iPhone 信任的 HTTPS 证书，并填写访问 HA 的最终地址。发送脚本遇到重定向会停止请求。

HA 保留最后一次有效上报，重启后恢复。同一上报时间新增的字段也会显示，较早的上报不会覆盖已有数据。“车辆数据已过期”在车辆上报时间超过 24 小时后开启，最后已知的数值仍可查看。iOS 的小组件刷新由系统调度。手动跑一次脚本也可能读到 BMW 端的缓存，判断车况刷新时间请看“车辆最后上报时间”。

参考 [HACS 自定义仓库](https://www.hacs.xyz/docs/faq/custom_repositories/)、[Home Assistant Marketplace](https://www.home-assistant.io/integrations/marketplace/#custom-repositories) 和 [Home Assistant Webhook](https://www.home-assistant.io/triggers/webhook/)。
