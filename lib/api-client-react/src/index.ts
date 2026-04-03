export * from "./generated/api";
export * from "./generated/api.schemas";
export { setBaseUrl, setAuthTokenGetter } from "./custom-fetch";
export type { AuthTokenGetter } from "./custom-fetch";

const API_KEY_STORAGE = "reposcope_api_key";

export function setApiKey(key: string | null): void {
  if (key) {
    localStorage.setItem(API_KEY_STORAGE, key);
  } else {
    localStorage.removeItem(API_KEY_STORAGE);
  }
}

export function getApiKey(): string | null {
  return localStorage.getItem(API_KEY_STORAGE);
}
