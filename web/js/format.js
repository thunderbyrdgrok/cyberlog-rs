const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const WEATHER = {
  0: "CLEAR",
  1: "MAINLY CLEAR",
  2: "PARTLY CLOUDY",
  3: "OVERCAST",
  45: "FOG",
  48: "RIME FOG",
  51: "LIGHT DRIZZLE",
  53: "DRIZZLE",
  55: "DENSE DRIZZLE",
  56: "FREEZING DRIZZLE",
  57: "DENSE FREEZING DRIZZLE",
  61: "LIGHT RAIN",
  63: "RAIN",
  65: "HEAVY RAIN",
  66: "FREEZING RAIN",
  67: "HEAVY FREEZING RAIN",
  71: "LIGHT SNOW",
  73: "SNOW",
  75: "HEAVY SNOW",
  77: "SNOW GRAINS",
  80: "LIGHT SHOWERS",
  81: "SHOWERS",
  82: "VIOLENT SHOWERS",
  85: "LIGHT SNOW SHOWERS",
  86: "HEAVY SNOW SHOWERS",
  95: "THUNDERSTORM",
  96: "THUNDERSTORM HAIL",
  99: "HEAVY THUNDERSTORM HAIL",
};

export function formatStamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "——", time: "——" };
  const day = `${String(date.getDate()).padStart(2, "0")} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  return { date: day, time };
}

export function formatCoord(latitude, longitude) {
  if (typeof latitude !== "number" || typeof longitude !== "number") return "";
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";
  const ns = latitude >= 0 ? "N" : "S";
  const ew = longitude >= 0 ? "E" : "W";
  return `${Math.abs(latitude).toFixed(5)}° ${ns}   ${Math.abs(longitude).toFixed(5)}° ${ew}`;
}

export function formatGps(gps) {
  if (!gps) return "";
  const base = formatCoord(gps.latitude, gps.longitude);
  if (!base) return "";
  if (typeof gps.accuracy === "number" && Number.isFinite(gps.accuracy)) {
    return `${base}   ±${Math.round(gps.accuracy)} M`;
  }
  return base;
}

export function formatTemp(celsius) {
  if (typeof celsius !== "number" || !Number.isFinite(celsius)) return "";
  const rounded = Math.round(celsius * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}°C` : `${rounded.toFixed(1)}°C`;
}

export function weatherLabel(code) {
  return WEATHER[code] || "UNKNOWN";
}

export function formatWeather(weather) {
  if (!weather) return "";
  const parts = [];
  const temp = formatTemp(weather.temperatureC);
  if (temp) parts.push(temp);
  if (weather.code != null) parts.push(weatherLabel(weather.code));
  if (typeof weather.windKmh === "number" && Number.isFinite(weather.windKmh)) {
    parts.push(`WIND ${Math.round(weather.windKmh)} KM/H`);
  }
  if (typeof weather.humidity === "number" && Number.isFinite(weather.humidity)) {
    parts.push(`RH ${Math.round(weather.humidity)}%`);
  }
  return parts.join("   ");
}

export function formatElevation(elevation) {
  if (!elevation || typeof elevation.meters !== "number" || !Number.isFinite(elevation.meters)) return "";
  const source = elevation.source === "pc-altimeter" ? "PC ALTIMETER" : "TERRAIN";
  return `${Math.round(elevation.meters)} M   ${source}`;
}

export function environmentRows(environment) {
  if (!environment) return [];
  const included = environment.included || {};
  const rows = [];
  if (included.gps && environment.gps) {
    const value = formatGps(environment.gps);
    if (value) rows.push({ key: "gps", label: "GPS", value });
  }
  if (included.weather && environment.weather) {
    const value = formatWeather(environment.weather);
    if (value) rows.push({ key: "weather", label: "WEATHER", value });
  }
  if (included.elevation && environment.elevation) {
    const value = formatElevation(environment.elevation);
    if (value) rows.push({ key: "elevation", label: "ELEVATION", value });
  }
  if (included.time && environment.time) {
    const stamp = formatStamp(environment.time);
    rows.push({ key: "time", label: "TIME", value: `${stamp.date}   ${stamp.time}` });
  }
  return rows;
}

export function compareEntriesDesc(a, b) {
  if (a.createdAt === b.createdAt) return a.id < b.id ? 1 : -1;
  return a.createdAt < b.createdAt ? 1 : -1;
}

export function countWords(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return 0;
  return cleaned.split(" ").length;
}

export function normalizeUrl(raw) {
  const value = String(raw || "").trim();
  if (!value || value.length > 2000) return "";
  if (/[\s<>"']/.test(value)) return "";
  if (/^(javascript|data|vbscript):/i.test(value)) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (/^mailto:/i.test(value)) return value;
  if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(value)) return `mailto:${value}`;
  if (/^[\w.-]+\.[a-z]{2,}(?:[/?#]\S*)?$/i.test(value)) return `https://${value}`;
  return "";
}
