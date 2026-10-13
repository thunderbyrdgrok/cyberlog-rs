const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const ELEVATION_URL = "https://api.open-meteo.com/v1/elevation";

function positionErrorMessage(error) {
  if (!error || error.code === 0) {
    return "This PC has no location sensor available to the journal.";
  }
  if (error.code === 1) {
    return "Location sensors are not enabled. Allow location access to include GPS, weather, and elevation.";
  }
  if (error.code === 3) return "The location sensor timed out. Try again.";
  return "The location sensor did not return a reading.";
}

function requestPosition() {
  if (!navigator.geolocation) {
    return Promise.reject(Object.assign(new Error("unsupported"), { code: 0 }));
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  });
}

async function readJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Sensor service answered ${response.status}`);
  return response.json();
}

async function fetchWeather(latitude, longitude) {
  const url = new URL(WEATHER_URL);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m");
  url.searchParams.set("timezone", "auto");
  const data = await readJson(url);
  const current = data.current || {};
  return {
    temperatureC: current.temperature_2m,
    humidity: current.relative_humidity_2m,
    code: current.weather_code,
    windKmh: current.wind_speed_10m,
  };
}

async function fetchElevation(latitude, longitude) {
  const url = new URL(ELEVATION_URL);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  const data = await readJson(url);
  const meters = data.elevation && data.elevation[0];
  if (typeof meters !== "number" || !Number.isFinite(meters)) {
    throw new Error("Elevation was missing.");
  }
  return meters;
}

export async function readEnvironment(options) {
  const included = {
    gps: Boolean(options.gps),
    weather: Boolean(options.weather),
    elevation: Boolean(options.elevation),
    time: Boolean(options.time),
  };
  const result = {
    included,
    gps: null,
    weather: null,
    elevation: null,
    time: null,
    capturedAt: new Date().toISOString(),
    warnings: [],
  };

  if (included.time) result.time = result.capturedAt;

  const needsPosition = included.gps || included.weather || included.elevation;
  if (!needsPosition) return result;

  let position;
  try {
    position = await requestPosition();
  } catch (error) {
    result.warnings.push(positionErrorMessage(error));
    return result;
  }

  const latitude = position.coords.latitude;
  const longitude = position.coords.longitude;

  if (included.gps) {
    result.gps = {
      latitude,
      longitude,
      accuracy: position.coords.accuracy,
    };
  }

  if (included.elevation) {
    const altitude = position.coords.altitude;
    if (typeof altitude === "number" && Number.isFinite(altitude)) {
      result.elevation = { meters: altitude, source: "pc-altimeter" };
    } else {
      try {
        const meters = await fetchElevation(latitude, longitude);
        result.elevation = { meters, source: "terrain" };
      } catch {
        result.warnings.push("Elevation is unavailable. The PC reported no altitude, and the terrain service did not answer.");
      }
    }
  }

  if (included.weather) {
    try {
      result.weather = await fetchWeather(latitude, longitude);
    } catch {
      result.warnings.push("Local weather is unavailable. The weather service did not answer.");
    }
  }

  return result;
}
