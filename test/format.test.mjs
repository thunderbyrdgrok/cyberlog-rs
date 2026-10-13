import assert from "node:assert/strict";
import test from "node:test";
import {
  compareEntriesDesc,
  countWords,
  environmentRows,
  formatCoord,
  formatElevation,
  formatGps,
  formatStamp,
  formatWeather,
  normalizeUrl,
  weatherLabel,
} from "../web/js/format.js";

test("formatStamp uses the local clock", () => {
  const date = new Date(2026, 9, 8, 21, 4, 5);
  const stamp = formatStamp(date);
  assert.equal(stamp.date, "08 OCT 2026");
  assert.equal(stamp.time, "21:04:05");
});

test("coordinates and elevation read as field data", () => {
  assert.equal(formatCoord(41.8781, -87.6298), "41.87810° N   87.62980° W");
  assert.equal(formatGps({ latitude: 41, longitude: -87, accuracy: 12.2 }), "41.00000° N   87.00000° W   ±12 M");
  assert.equal(formatElevation({ meters: 181.4, source: "terrain" }), "181 M   TERRAIN");
  assert.equal(formatElevation({ meters: 40, source: "pc-altimeter" }), "40 M   PC ALTIMETER");
});

test("weather codes include clear sky", () => {
  assert.equal(weatherLabel(0), "CLEAR");
  assert.equal(weatherLabel(95), "THUNDERSTORM");
  assert.equal(weatherLabel(1234), "UNKNOWN");
  assert.match(formatWeather({ temperatureC: 12.4, code: 1, windKmh: 8.2, humidity: 55 }), /12\.4°C/);
  assert.match(formatWeather({ temperatureC: 12.4, code: 1, windKmh: 8.2, humidity: 55 }), /MAINLY CLEAR/);
});

test("environment rows follow the included flags", () => {
  const rows = environmentRows({
    included: { gps: true, weather: false, elevation: true, time: true },
    gps: { latitude: 10, longitude: 20, accuracy: 5 },
    weather: { temperatureC: 1, code: 0 },
    elevation: { meters: 9, source: "terrain" },
    time: new Date(2026, 9, 8, 9, 1, 2).toISOString(),
  });
  assert.deepEqual(rows.map((row) => row.label), ["GPS", "ELEVATION", "TIME"]);
});

test("newest logs sort first", () => {
  const entries = [
    { id: "a", createdAt: "2026-10-08T10:00:00.000Z" },
    { id: "c", createdAt: "2026-10-08T12:00:00.000Z" },
    { id: "b", createdAt: "2026-10-08T11:00:00.000Z" },
  ];
  assert.deepEqual(entries.sort(compareEntriesDesc).map((entry) => entry.id), ["c", "b", "a"]);
});

test("word count and links", () => {
  assert.equal(countWords("  one   two three "), 3);
  assert.equal(countWords("   "), 0);
  assert.equal(normalizeUrl("example.com/path"), "https://example.com/path");
  assert.equal(normalizeUrl("ada@example.com"), "mailto:ada@example.com");
  assert.equal(normalizeUrl("javascript:alert(1)"), "");
  assert.equal(normalizeUrl("https://logs.example/entry"), "https://logs.example/entry");
});
