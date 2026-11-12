import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import {
  DEFAULT_PLACE,
  GEO_OPTIONS,
  type GeocodeResult,
  formatStreetAddress,
  placeAfterLookup,
  shouldRequestPosition,
  trimFormattedAddress,
} from "../src/location";

const palatine: GeocodeResult = {
  geometry: { location_type: "ROOFTOP" },
  formatted_address: "123 N Main St, Palatine, IL 60067, USA",
  address_components: [
    { long_name: "123", short_name: "123", types: ["street_number"] },
    { long_name: "North Main Street", short_name: "N Main St", types: ["route"] },
    { long_name: "Palatine", short_name: "Palatine", types: ["locality", "political"] },
    { long_name: "Illinois", short_name: "IL", types: ["administrative_area_level_1", "political"] },
    { long_name: "60067", short_name: "60067", types: ["postal_code"] },
    { long_name: "United States", short_name: "US", types: ["country", "political"] },
  ],
};

const base = {
  permission: "granted" as const,
  key: "maps-key",
  place: DEFAULT_PLACE,
  edited: false,
  alreadyAskedWhilePrompt: false,
};

describe("street address", () => {
  it("builds house number, street, city, and state from a precise result", () => {
    expect(formatStreetAddress([palatine])).toBe("123 N Main St, Palatine, IL");
  });

  it("uses the first rooftop or range-interpolated result", () => {
    const rough: GeocodeResult = {
      ...palatine,
      geometry: { location_type: "GEOMETRIC_CENTER" },
      formatted_address: "Palatine, IL 60067, USA",
    };
    const interpolated: GeocodeResult = {
      ...palatine,
      geometry: { location_type: "RANGE_INTERPOLATED" },
      address_components: palatine.address_components?.map((part) =>
        part.types.includes("street_number") ? { ...part, long_name: "50", short_name: "50" } : part,
      ),
    };
    expect(formatStreetAddress([rough])).toBeNull();
    expect(formatStreetAddress([rough, interpolated, palatine])).toBe("50 N Main St, Palatine, IL");
  });

  it("trims the ZIP and country from formatted_address when a component is missing", () => {
    const partial: GeocodeResult = {
      ...palatine,
      address_components: palatine.address_components?.filter((part) => !part.types.includes("street_number")),
    };
    expect(formatStreetAddress([partial])).toBe("123 N Main St, Palatine, IL");
    expect(trimFormattedAddress("123 N Main St, Palatine, IL 60067-1234, United States")).toBe("123 N Main St, Palatine, IL");
    expect(trimFormattedAddress("123 N Main St, Palatine, IL, USA")).toBe("123 N Main St, Palatine, IL");
  });
});

describe("location fallbacks", () => {
  it("reads a granted position every time and lets a prompt happen once", () => {
    expect(shouldRequestPosition({ ...base, permission: "granted" })).toBe(true);
    expect(shouldRequestPosition({ ...base, permission: "granted", alreadyAskedWhilePrompt: true })).toBe(true);
    expect(shouldRequestPosition({ ...base, permission: "prompt" })).toBe(true);
    expect(shouldRequestPosition({ ...base, permission: "unknown" })).toBe(true);
    expect(shouldRequestPosition({ ...base, permission: "prompt", alreadyAskedWhilePrompt: true })).toBe(false);
  });

  it("stays on Chicago when permission is denied, the key is empty, the lookup times out, or nothing matches", () => {
    expect(shouldRequestPosition({ ...base, permission: "denied" })).toBe(false);
    expect(shouldRequestPosition({ ...base, key: "  " })).toBe(false);
    expect(placeAfterLookup(DEFAULT_PLACE, false, null)).toBe(DEFAULT_PLACE);
    expect(placeAfterLookup(DEFAULT_PLACE, false, "  ")).toBe(DEFAULT_PLACE);
    expect(formatStreetAddress([])).toBeNull();
  });

  it("does not overwrite a place that was typed", () => {
    expect(shouldRequestPosition({ ...base, edited: true })).toBe(false);
    expect(shouldRequestPosition({ ...base, place: "Oak Park, IL" })).toBe(false);
    expect(placeAfterLookup("Oak Park, IL", false, "123 N Main St, Palatine, IL")).toBe("Oak Park, IL");
    expect(placeAfterLookup(DEFAULT_PLACE, true, "123 N Main St, Palatine, IL")).toBe(DEFAULT_PLACE);
    expect(placeAfterLookup("", true, "123 N Main St, Palatine, IL")).toBe("");
  });

  it("fills the default place when a street address comes back", () => {
    expect(placeAfterLookup(DEFAULT_PLACE, false, "123 N Main St, Palatine, IL")).toBe("123 N Main St, Palatine, IL");
  });

  it("asks the browser for a fresh high-accuracy fix", () => {
    expect(GEO_OPTIONS).toEqual({ enableHighAccuracy: true, timeout: 10_000, maximumAge: 120_000 });
  });
});

describe("location setup", () => {
  it("keeps the Maps key empty and loads geocoding through the JavaScript library", () => {
    expect(config.GOOGLE_MAPS_API_KEY).toBe("");
    const location = readFileSync("src/location.ts", "utf8");
    const app = ["src/main.ts", "src/weather.ts"].map((file) => readFileSync(file, "utf8")).join("\n");
    expect(location).toContain('importLibrary!("geocoding")');
    expect(location).toContain("geolocation.getCurrentPosition");
    expect(`${location}\n${app}`).not.toContain("/maps/api/geocode");
    expect(app).not.toContain("geolocation.getCurrentPosition");
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain('http-equiv="Permissions-Policy" content="geolocation=(self)"');
    const csp = readFileSync("vite.config.ts", "utf8");
    expect(csp).toContain("https://maps.googleapis.com https://maps.gstatic.com");
    expect(csp).toContain("https://oauth2.googleapis.com https://maps.googleapis.com");
    expect(csp).not.toContain("https://*.googleapis.com");
  });
});
