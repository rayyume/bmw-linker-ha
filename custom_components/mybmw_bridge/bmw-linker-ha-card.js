const CARD_TYPE = "bmw-linker-ha-vehicle";
const isVehicle = (state) => state?.attributes?.bmw_linker_vehicle === true;
const isKnown = (state) => Boolean(state && !["unavailable", "unknown"].includes(state.state));
const vehicleEntities = (hass) => Object.values(hass?.states ?? {}).filter(isVehicle);

const words = {
  zh: {
    title: "BMW 车辆", select: "选择车辆", pick: "编辑卡片并选择车辆", waiting: "等待 Scriptable 上报",
    missingPhoto: "等待车型图", mileage: "总里程", range: "续航", fuelRange: "燃油续航", electricRange: "纯电续航", fuel: "剩余燃油", battery: "电量",
    fuelUse: "最近油耗", electricUse: "最近电耗", tires: "胎压", frontLeft: "左前", frontRight: "右前",
    rearLeft: "左后", rearRight: "右后", locked: "已上锁", unlocked: "已解锁", lockUnknown: "车锁状态未知",
    closed: "门窗已关闭", openingsUnknown: "门窗状态未知", doors: "车门", windows: "车窗",
    roof: "天窗", hood: "引擎盖", trunk: "后备箱", open: "未关闭", updated: "上报",
    stale: "车况已超过 24 小时", location: "在地图上查看", image: "自定义车型图地址（选填）",
  },
  en: {
    title: "BMW vehicle", select: "Choose vehicle", pick: "Choose a vehicle in the card editor",
    waiting: "Waiting for a Scriptable report", missingPhoto: "Waiting for a vehicle photo",
    mileage: "Odometer", range: "Range", fuelRange: "Fuel range", electricRange: "Electric range", fuel: "Fuel remaining", battery: "Battery",
    fuelUse: "Last trip fuel", electricUse: "Last trip electricity", tires: "Tire pressure", frontLeft: "Front left",
    frontRight: "Front right", rearLeft: "Rear left", rearRight: "Rear right", locked: "Locked",
    unlocked: "Unlocked", lockUnknown: "Lock state unknown", closed: "Doors and windows closed",
    openingsUnknown: "Opening status unknown", doors: "Doors", windows: "Windows", roof: "Sunroof",
    hood: "Hood", trunk: "Trunk", open: "open", updated: "Reported",
    stale: "Report older than 24 hours", location: "View on map", image: "Custom vehicle image URL (optional)",
  },
};

function textFor(hass) {
  return hass?.language?.startsWith("zh") ? words.zh : words.en;
}

function relatedEntity(hass, detailsId, domain) {
  const registry = hass.entities ?? {};
  const deviceId = registry[detailsId]?.device_id;
  if (!deviceId) return undefined;
  const match = Object.entries(registry).find(([id, entry]) =>
    id.startsWith(domain + ".") && entry.device_id === deviceId && entry.platform === "mybmw_bridge");
  return match && hass.states[match[0]];
}

function formatNumber(value, locale, precision = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: precision,
    minimumFractionDigits: precision,
  }).format(value);
}

function formatUnit(value, unit, locale, precision) {
  const formatted = formatNumber(value, locale, precision);
  return formatted ? formatted + " " + unit : "";
}

function formatConsumption(value, monthly, unit, locale) {
  const reading = formatUnit(value, unit, locale, 1);
  if (!reading || typeof monthly !== "number") return reading;
  return reading + " " + (value > monthly ? "↑" : value < monthly ? "↓" : "↔");
}

function formatReported(value, locale) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function safeImage(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value, location.origin);
    if (url.origin === location.origin || url.protocol === "https:") return url.href;
  } catch {
    return "";
  }
  return "";
}

const layout = document.createElement("template");
layout.innerHTML = `
  <style>
    :host { display: block; }
    [hidden] { display: none !important; }
    ha-card { display: block; overflow: hidden; container-type: inline-size; border-radius: var(--ha-card-border-radius, 16px); background: var(--ha-card-background, var(--card-background-color, #fff)); }
    .hero { display: grid; color: #f4f7fc; background: #152538; }
    .heading { padding: 20px 22px 5px; display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; }
    .heading h2 { margin: 0; font-size: clamp(21px, 5.25cqw, 34px); line-height: 1.15; font-weight: 650; overflow-wrap: anywhere; }
    .plate { margin: 5px 0 0; min-height: 1lh; color: #becbdb; font-size: 13px; }
    .lock { display: inline-flex; align-items: center; gap: 5px; color: #b7c5d5; font-size: 12px; padding: 5px 8px; border: 1px solid #506277; border-radius: 8px; }
    .lock[data-state="good"] { color: #9de7c4; }
    .lock[data-state="alert"] { color: #ffd1a0; }
    ha-icon { --mdc-icon-size: 17px; flex: none; }
    .photo { margin: 0; display: grid; align-items: center; justify-items: center; min-height: 82px; }
    .photo img { padding: 4px 12px 10px; box-sizing: border-box; display: block; max-width: min(100%, 540px); max-height: 230px; width: 100%; aspect-ratio: 2.35; object-fit: contain; }
    .missing-photo { font-size: 12px; color: #b7c5d5; margin: 12px; }
    .body { padding: 16px 20px 14px; }
    .metrics { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 13px 16px; }
    .metric { min-width: 0; display: grid; gap: 2px; }
    .metric span, .tires h3 { font-size: 12px; color: var(--secondary-text-color, #64748b); }
    .metric strong { font-size: clamp(16px, 4cqw, 22px); font-weight: 650; line-height: 1.2; overflow-wrap: anywhere; }
    strong, .pressures, footer { font-variant-numeric: tabular-nums; }
    .tires { margin-top: 15px; padding-top: 11px; border-top: 1px solid var(--divider-color, #dce3ec); }
    .tires h3 { margin: 0 0 7px; font-weight: 500; }
    .pressures { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 8px 12px; }
    .pressure { display: grid; gap: 1px; min-width: 0; font-size: 12px; }
    .pressure-label { color: var(--secondary-text-color, #64748b); }
    .pressure strong { font-weight: 600; }
    .pressure[data-direction="different"] strong { color: var(--warning-color, #a15c13); }
    footer { padding: 10px 20px 12px; border-top: 1px solid var(--divider-color, #dce3ec); font-size: 12px; display: grid; gap: 7px; }
    .status { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 10px; }
    .openings { display: inline-flex; align-items: center; gap: 6px; }
    .openings[data-state="good"] ha-icon { color: var(--success-color, #26845a); }
    .openings[data-state="alert"] ha-icon, .stale { color: var(--warning-color, #a15c13); }
    .timestamp, .empty { color: var(--secondary-text-color, #64748b); }
    .address { color: var(--primary-text-color, #273648); text-align: start; font: inherit; display: flex; gap: 6px; align-items: flex-start; width: fit-content; padding: 2px 0; border: 0; background: transparent; overflow-wrap: anywhere; }
    button.address { color: var(--primary-color, #1470b8); cursor: pointer; }
    button.address:hover { text-decoration: underline; }
    button.address:focus-visible { outline: 2px solid var(--primary-color, #1470b8); outline-offset: 3px; border-radius: 2px; }
    .empty { padding: 15px 20px; font-size: 14px; }
    @container (max-width: 335px) {
      .heading, .body, footer { padding-left: 13px; padding-right: 13px; }
      .pressures { grid-template-columns: repeat(2,minmax(0,1fr)); }
    }
  </style>
  <ha-card>
    <section class="hero">
      <header class="heading">
        <div><h2 id="title"></h2><p class="plate" id="plate" hidden></p></div>
        <div class="lock" id="lock" hidden><ha-icon></ha-icon><span></span></div>
      </header>
      <figure class="photo" id="photo"><img hidden alt=""><span class="missing-photo"></span></figure>
    </section>
    <div class="body" id="body" hidden>
      <div class="metrics"></div>
      <section class="tires" hidden><h3></h3><div class="pressures"></div></section>
    </div>
    <div class="empty" id="empty" hidden></div>
    <footer hidden>
      <div class="status">
        <div class="openings"><ha-icon></ha-icon><span></span></div>
        <time class="timestamp"></time>
      </div>
      <div class="stale" hidden></div>
      <button type="button" class="address" hidden><ha-icon icon="mdi:map-marker-outline"></ha-icon><span></span></button>
      <div class="address" hidden><ha-icon icon="mdi:map-marker-outline"></ha-icon><span></span></div>
    </footer>
  </ha-card>
`;

const tireKeys = {
  front_left: "frontLeft",
  front_right: "frontRight",
  rear_left: "rearLeft",
  rear_right: "rearRight",
};
const openingKeys = {
  doors_open: "doors",
  windows_open: "windows",
  sunroof_open: "roof",
  hood_open: "hood",
  trunk_open: "trunk",
};

function setStatus(element, text, icon, state) {
  element.dataset.state = state;
  element.querySelector("ha-icon").setAttribute("icon", icon);
  element.querySelector("span").textContent = text;
}

function openingStatus(data, labels) {
  const open = Object.entries(openingKeys).filter(([key]) => data[key] === true);
  if (open.length) {
    const names = open.map(([, key]) => labels[key]);
    const joined = names.join(labels === words.zh ? "、" : ", ");
    return [joined + (labels === words.zh ? "" : " ") + labels.open, "mdi:shield-alert-outline", "alert"];
  }
  if (data.doors_open === false && data.windows_open === false) {
    return [labels.closed, "mdi:shield-check-outline", "good"];
  }
  return [labels.openingsUnknown, "mdi:shield-outline", "unknown"];
}

class BmwLinkerVehicleCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).append(layout.content.cloneNode(true));
    const root = this.shadowRoot;
    this.parts = {
      title: root.querySelector("#title"), plate: root.querySelector("#plate"), lock: root.querySelector("#lock"),
      photo: root.querySelector("img"), photoPlaceholder: root.querySelector(".missing-photo"),
      body: root.querySelector("#body"), empty: root.querySelector("#empty"), metrics: root.querySelector(".metrics"),
      tires: root.querySelector(".tires"), tireHeading: root.querySelector("h3"), pressures: root.querySelector(".pressures"),
      footer: root.querySelector("footer"), openings: root.querySelector(".openings"), timestamp: root.querySelector("time"),
      stale: root.querySelector(".stale"), map: root.querySelector("button.address"), address: root.querySelector("div.address"),
    };
    this.parts.map.addEventListener("click", () => {
      if (!this.trackerId) return;
      this.dispatchEvent(new CustomEvent("hass-more-info", {
        detail: { entityId: this.trackerId }, bubbles: true, composed: true,
      }));
    });
    this.parts.photo.addEventListener("load", () => {
      this.parts.photo.hidden = false;
      this.parts.photoPlaceholder.hidden = true;
    });
    this.parts.photo.addEventListener("error", () => {
      this.parts.photo.hidden = true;
      this.parts.photoPlaceholder.hidden = false;
    });
  }

  static getConfigElement() {
    return document.createElement("bmw-linker-ha-vehicle-editor");
  }

  static getStubConfig(hass) {
    return { entity: vehicleEntities(hass)[0]?.entity_id ?? "" };
  }

  setConfig(config) {
    if (config.entity && typeof config.entity !== "string") throw new Error("Expected a vehicle details entity");
    this.config = config;
    this.previous = null;
    this.render();
  }

  set hass(hass) {
    this.hassData = hass;
    this.render();
  }

  getCardSize() {
    return 7;
  }

  render() {
    const hass = this.hassData;
    if (!this.config || !hass) return;
    const { entity, image } = this.config;
    const candidate = hass.states[entity];
    const details = isVehicle(candidate) ? candidate : undefined;
    const photo = details && relatedEntity(hass, entity, "image");
    const tracker = details && relatedEntity(hass, entity, "device_tracker");
    const stale = isKnown(details) && Date.now() - Date.parse(details.state) >= 86400000;
    const inputs = [details, photo, tracker, stale, hass.language, hass.locale?.language];
    if (this.previous && inputs.every((value, index) => value === this.previous[index])) return;
    this.previous = inputs;

    const parts = this.parts;
    const labels = textFor(hass);
    const locale = hass.locale?.language || hass.language || "en";
    const data = details?.attributes.telemetry ?? {};
    parts.title.textContent = data.display_name || [data.brand, data.model].filter(Boolean).join(" ") || labels.title;
    parts.plate.textContent = data.display_plate || data.license_plate || "";
    parts.plate.hidden = !parts.plate.textContent;
    parts.body.hidden = parts.footer.hidden = !isKnown(details);
    parts.empty.hidden = isKnown(details);
    parts.empty.textContent = entity ? labels.waiting : labels.pick;
    parts.lock.hidden = !isKnown(details);
    parts.photoPlaceholder.textContent = labels.missingPhoto;

    const autoUrl = isKnown(photo) && safeImage(photo.attributes.entity_picture);
    const imageURL = safeImage(image) || (autoUrl ? autoUrl + (autoUrl.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(photo.state) : "");
    if (imageURL !== this.imageURL) {
      this.imageURL = imageURL;
      parts.photo.hidden = true;
      parts.photoPlaceholder.hidden = Boolean(imageURL);
      if (imageURL) parts.photo.src = imageURL;
      else parts.photo.removeAttribute("src");
    }
    if (!isKnown(details)) return;

    const locked = data.door_state;
    setStatus(parts.lock,
      locked === "LOCKED" ? labels.locked : locked === "UNLOCKED" ? labels.unlocked : labels.lockUnknown,
      locked === "UNLOCKED" ? "mdi:lock-open-variant-outline" : "mdi:lock-outline",
      locked === "LOCKED" ? "good" : locked === "UNLOCKED" ? "alert" : "unknown");

    const fuelUse = formatConsumption(data.last_trip_fuel_consumption, data.monthly_fuel_consumption, "L/100 km", locale);
    const electricUse = formatConsumption(data.last_trip_electric_consumption, data.monthly_electric_consumption, "kWh/100 km", locale);
    const fuelRange = formatUnit(data.fuel_range_km, "km", locale);
    const electricRange = formatUnit(data.electric_range_km, "km", locale);
    const ranges = fuelRange && electricRange
      ? [[labels.fuelRange, fuelRange], [labels.electricRange, electricRange]]
      : [[labels.range, fuelRange || electricRange]];
    let fuelLiters = formatUnit(data.fuel_liters, "L", locale);
    if (!fuelLiters && typeof data.fuel_tank_liters === "number" && typeof data.fuel_percent === "number") {
      fuelLiters = "≈" + formatUnit(data.fuel_tank_liters * data.fuel_percent / 100, "L", locale);
    }
    const fuel = [fuelLiters, formatUnit(data.fuel_percent, "%", locale)].filter(Boolean);
    const metrics = [
      [labels.mileage, formatUnit(data.odometer_km, "km", locale)],
      ...ranges,
      [labels.fuel, fuel.join(" / ")],
      [labels.battery, formatUnit(data.battery_percent, "%", locale)],
      [labels.fuelUse, fuelUse || (!electricUse && data.consumption_summary?.startsWith("油耗 ") ? data.consumption_summary.slice(3) : "")],
      [labels.electricUse, electricUse || (!fuelUse && data.consumption_summary?.startsWith("电耗 ") ? data.consumption_summary.slice(3) : "")],
    ];
    parts.metrics.replaceChildren(...metrics.filter(([, value]) => value).map(([label, value]) => {
      const metric = document.createElement("div");
      const caption = document.createElement("span");
      const reading = document.createElement("strong");
      metric.className = "metric";
      caption.textContent = label;
      reading.textContent = value;
      metric.append(caption, reading);
      return metric;
    }));

    const pressures = Object.entries(tireKeys).filter(([key]) => typeof data[key + "_pressure"] === "number");
    parts.tires.hidden = !pressures.length;
    parts.tireHeading.textContent = labels.tires + " · bar";
    parts.pressures.replaceChildren(...pressures.map(([key, position]) => {
      const actual = data[key + "_pressure"];
      const target = data[key + "_target_pressure"];
      const direction = typeof target !== "number" ? "" : actual > target ? "↑" : actual < target ? "↓" : "↔";
      const pressure = document.createElement("div");
      const caption = document.createElement("span");
      const reading = document.createElement("strong");
      pressure.className = "pressure";
      pressure.dataset.direction = direction === "↑" || direction === "↓" ? "different" : "normal";
      caption.className = "pressure-label";
      caption.textContent = labels[position];
      reading.textContent = [formatNumber(actual / 100, locale, 1), direction].filter(Boolean).join(" ");
      pressure.append(caption, reading);
      return pressure;
    }));

    setStatus(parts.openings, ...openingStatus(data, labels));
    const reported = formatReported(details.state, locale);
    parts.timestamp.dateTime = details.state;
    parts.timestamp.textContent = reported ? labels.updated + " " + reported : "";
    parts.stale.textContent = labels.stale;
    parts.stale.hidden = !stale;
    const trackerLocation = tracker?.attributes;
    this.trackerId = isKnown(tracker) && Number.isFinite(trackerLocation.latitude) && Number.isFinite(trackerLocation.longitude)
      ? tracker.entity_id : null;
    parts.map.hidden = !this.trackerId;
    parts.address.hidden = Boolean(this.trackerId) || !data.address;
    parts.map.querySelector("span").textContent = data.address || labels.location;
    parts.address.querySelector("span").textContent = data.address || "";
  }
}

class BmwLinkerVehicleEditor extends HTMLElement {
  connectedCallback() {
    if (this.select) return;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        label { display: grid; gap: 6px; margin: 12px 0; color: var(--primary-text-color); }
        select, input { font: inherit; min-width: 0; width: 100%; box-sizing: border-box; color: var(--primary-text-color); background: var(--card-background-color); padding: 9px; border: 1px solid var(--divider-color); border-radius: 4px; }
      </style>
      <label><span></span><select></select></label>
      <label><span></span><input type="text" spellcheck="false" placeholder="/local/bmw-x3.png"></label>
    `;
    this.select = this.shadowRoot.querySelector("select");
    this.image = this.shadowRoot.querySelector("input");
    this.select.addEventListener("change", () => this.save());
    this.image.addEventListener("change", () => this.save());
    this.render();
  }

  setConfig(config) {
    this.config = config;
    this.render();
  }

  set hass(hass) {
    this.hassData = hass;
    if (this.select !== this.shadowRoot?.activeElement && this.image !== this.shadowRoot?.activeElement) this.render();
  }

  render() {
    if (!this.select || !this.config || !this.hassData) return;
    const labels = textFor(this.hassData);
    const [selectLabel, imageLabel] = this.shadowRoot.querySelectorAll("label span");
    selectLabel.textContent = labels.select;
    imageLabel.textContent = labels.image;
    const options = vehicleEntities(this.hassData).map((state) => [state.attributes.friendly_name || state.entity_id, state.entity_id]);
    if (this.config.entity && !options.some(([, id]) => id === this.config.entity)) {
      options.push([this.config.entity, this.config.entity]);
    }
    this.select.replaceChildren(new Option(labels.select, ""), ...options.map(([label, id]) => new Option(label, id)));
    this.select.value = this.config.entity || "";
    this.image.value = this.config.image || "";
  }

  save() {
    const config = { ...this.config, entity: this.select.value };
    const image = this.image.value.trim();
    if (image) config.image = image;
    else delete config.image;
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config }, bubbles: true, composed: true,
    }));
  }
}

if (!customElements.get(CARD_TYPE)) {
  customElements.define(CARD_TYPE, BmwLinkerVehicleCard);
  customElements.define("bmw-linker-ha-vehicle-editor", BmwLinkerVehicleEditor);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: CARD_TYPE, name: "BMW Linker Vehicle", description: "Live BMW vehicle status, tire pressures and parking location",
  });
}
