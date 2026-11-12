import { formatWeather } from "./journal/text";

const CHICAGO = { latitude: 41.8781, longitude: -87.6298 };

export function chooseWeather(online: boolean, fresh: string | null, cached: string | null): string | null {
  if (online && fresh) return fresh;
  return cached;
}

export async function lookupWeather(place: string): Promise<string | null> {
  try {
    const coords =
      place.trim().toLowerCase() === "chicago, il" ? CHICAGO : await geocode(place.trim());
    if (!coords) return null;
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(coords.latitude));
    url.searchParams.set("longitude", String(coords.longitude));
    url.searchParams.set("current", "temperature_2m,weather_code");
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("timezone", "America/Chicago");
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const data = (await response.json()) as { current?: { temperature_2m?: number; weather_code?: number } };
    const temp = data.current?.temperature_2m;
    const code = data.current?.weather_code;
    if (typeof temp !== "number" || typeof code !== "number") return null;
    return formatWeather(code, temp);
  } catch {
    return null;
  }
}

async function geocode(name: string): Promise<{ latitude: number; longitude: number } | null> {
  if (!name) return null;
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) return null;
  const data = (await response.json()) as { results?: Array<{ latitude?: number; longitude?: number }> };
  const hit = data.results?.[0];
  if (!hit || typeof hit.latitude !== "number" || typeof hit.longitude !== "number") return null;
  return { latitude: hit.latitude, longitude: hit.longitude };
}
