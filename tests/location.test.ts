import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import {
  DEFAULT_PLACE,
  GEO_OPTIONS,
  LOCATE_HINT,
  type GeocodeResult,
  formatStreetAddress,
  locateAction,
  placeAfterLocate,
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

describe("location button", () => {
  it("asks on a tap when Chrome can prompt or already allowed it", () => {
    expect(locateAction("granted", "maps-key")).toBe("position");
    expect(locateAction("prompt", "maps-key")).toBe("position");
    expect(locateAction("unknown", "maps-key")).toBe("position");
  });

  it("fails without asking when permission is denied or the key is empty", () => {
    expect(locateAction("denied", "maps-key")).toBe("fail");
    expect(locateAction("granted", "  ")).toBe("fail");
    expect(locateAction("prompt", "")).toBe("fail");
  });

  it("leaves the field unchanged and sets a hint when the lookup misses", () => {
    expect(placeAfterLocate(DEFAULT_PLACE, null)).toEqual({ place: DEFAULT_PLACE, hint: LOCATE_HINT });
    expect(placeAfterLocate("Oak Park, IL", "  ")).toEqual({ place: "Oak Park, IL", hint: LOCATE_HINT });
    expect(formatStreetAddress([])).toBeNull();
  });

  it("replaces whatever is in the field when a street address comes back", () => {
    expect(placeAfterLocate(DEFAULT_PLACE, "123 N Main St, Palatine, IL")).toEqual({
      place: "123 N Main St, Palatine, IL",
      hint: "",
    });
    expect(placeAfterLocate("Oak Park, IL", "123 N Main St, Palatine, IL")).toEqual({
      place: "123 N Main St, Palatine, IL",
      hint: "",
    });
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
    const main = readFileSync("src/main.ts", "utf8");
    expect(main).toContain('id: "locate"');
    expect(main).not.toContain("beginEntryLocation");
    expect(main).not.toContain("focusin");
    const csp = readFileSync("vite.config.ts", "utf8");
    expect(csp).toContain("https://maps.googleapis.com https://maps.gstatic.com");
    expect(csp).toContain("https://oauth2.googleapis.com https://maps.googleapis.com");
    expect(csp).not.toContain("https://*.googleapis.com");
  });
});
