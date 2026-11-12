/** Street address used until a device fix is available. */
export const DEFAULT_PLACE = "Chicago, IL";

/** High accuracy, about 10 seconds, and a fix up to about 2 minutes old. */
export const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 2 * 60 * 1000,
};

export type GeoPermission = "granted" | "prompt" | "denied" | "unknown";

const PRECISE = new Set(["ROOFTOP", "RANGE_INTERPOLATED"]);

export interface AddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

export interface GeocodeResult {
  formatted_address?: string;
  address_components?: AddressComponent[];
  geometry?: { location_type?: string };
}

export const LOCATE_HINT = "Couldn't use this location.";

/**
 * A tap reads the position. Granted is silent. Prompt lets Chrome ask once.
 * Denied, or an empty Maps key, fails without asking.
 */
export function locateAction(permission: GeoPermission, key: string): "position" | "fail" {
  if (!key.trim() || permission === "denied") return "fail";
  return "position";
}

/** A found address replaces the field. A miss leaves the current text and sets a hint. */
export function placeAfterLocate(current: string, address: string | null): { place: string; hint: string } {
  const next = address?.trim();
  if (!next) return { place: current, hint: LOCATE_HINT };
  return { place: next, hint: "" };
}

export function formatStreetAddress(results: GeocodeResult[]): string | null {
  const hit = results.find((result) => PRECISE.has(result.geometry?.location_type ?? ""));
  if (!hit) return null;
  return fromComponents(hit.address_components ?? []) ?? trimFormattedAddress(hit.formatted_address ?? "") ?? null;
}

export function trimFormattedAddress(formatted: string): string | null {
  let text = formatted.trim();
  text = text.replace(/,\s*(USA|U\.S\.A\.|US|United States of America|United States)\.?$/i, "");
  text = text.replace(/,?\s*\b\d{5}(?:-\d{4})?\b$/, "");
  text = text.replace(/,\s*$/, "").trim();
  return text || null;
}

function fromComponents(components: AddressComponent[]): string | null {
  const number = component(components, "street_number");
  const route = component(components, "route", true);
  const city =
    component(components, "locality") ||
    component(components, "postal_town") ||
    component(components, "sublocality_level_1") ||
    component(components, "sublocality");
  const state = component(components, "administrative_area_level_1", true);
  if (!number || !route || !city || !state) return null;
  return `${number} ${route}, ${city}, ${state}`;
}

export async function readGeoPermission(): Promise<GeoPermission> {
  try {
    if (!navigator.permissions?.query) return "unknown";
    const status = await navigator.permissions.query({ name: "geolocation" });
    if (status.state === "granted" || status.state === "prompt" || status.state === "denied") return status.state;
    return "unknown";
  } catch {
    return "unknown";
  }
}

/** The coordinates exist only until the street address comes back. */
export function readCurrentPosition(): Promise<{ latitude: number; longitude: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => resolve(null),
      GEO_OPTIONS,
    );
  });
}

function component(components: AddressComponent[], type: string, short = false): string {
  const found = components.find((item) => item.types.includes(type));
  if (!found) return "";
  return (short ? found.short_name : found.long_name).trim();
}

interface MapsGeocoder {
  geocode(request: { location: { lat: number; lng: number } }): Promise<{ results?: GeocodeResult[] }>;
}

interface GeocodingLibrary {
  Geocoder: new () => MapsGeocoder;
}

interface GoogleMaps {
  importLibrary?: (name: string) => Promise<GeocodingLibrary>;
  __ib__?: () => void;
}

/** Official bootstrap loader. The geocoding library is requested only when this runs. */
export async function reverseStreetAddress(latitude: number, longitude: number, key: string): Promise<string | null> {
  if (!key.trim()) return null;
  try {
    const { Geocoder } = await importGeocoding(key);
    const response = await new Geocoder().geocode({ location: { lat: latitude, lng: longitude } });
    return formatStreetAddress(response.results ?? []);
  } catch {
    return null;
  }
}

function mapsRoot(): { google: { maps: GoogleMaps } } {
  const root = window as unknown as { google?: { maps?: GoogleMaps } };
  const google = (root.google ??= {});
  google.maps ??= {};
  return { google: google as { maps: GoogleMaps } };
}

let loader: Promise<void> | undefined;

function importGeocoding(key: string): Promise<GeocodingLibrary> {
  const { google } = mapsRoot();
  installBootstrap(google.maps, key);
  return google.maps.importLibrary!("geocoding");
}

function installBootstrap(maps: GoogleMaps, key: string): void {
  if (typeof maps.importLibrary === "function") return;
  const libraries = new Set<string>();
  const settings: Record<string, string> = { key, v: "weekly" };
  const load = () =>
    (loader ??= new Promise<void>((resolve, reject) => {
      const params = new URLSearchParams();
      params.set("libraries", [...libraries].join(","));
      for (const name of Object.keys(settings)) {
        params.set(name.replace(/[A-Z]/g, (char) => `_${char[0].toLowerCase()}`), settings[name]);
      }
      params.set("callback", "google.maps.__ib__");
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
      script.async = true;
      maps.__ib__ = () => resolve();
      script.onerror = () => {
        loader = undefined;
        maps.importLibrary = undefined;
        maps.__ib__ = undefined;
        script.remove();
        reject(new Error("The Google Maps JavaScript API could not load."));
      };
      const nonce = document.querySelector("script[nonce]")?.getAttribute("nonce");
      if (nonce) script.nonce = nonce;
      document.head.append(script);
    }));
  maps.importLibrary = (name) => {
    libraries.add(name);
    return load().then(() => maps.importLibrary!(name));
  };
}
