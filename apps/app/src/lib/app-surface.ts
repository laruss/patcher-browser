import {
  APP_SURFACE_DESKTOP,
  APP_SURFACE_HEADER_NAME,
  APP_SURFACE_WEB,
  type AppSurface,
} from "@patcher/config/app-surface";
import { getPatcherDesktopInfo } from "./patcher-desktop";

export function getAppSurface(): AppSurface {
  // Through the accessor, so the global the preload exposes is named in
  // exactly one place.
  if (getPatcherDesktopInfo() !== null) {
    return APP_SURFACE_DESKTOP;
  }
  return APP_SURFACE_WEB;
}

export function appSurfaceRequestInit(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set(APP_SURFACE_HEADER_NAME, getAppSurface());
  return {
    ...init,
    headers,
  };
}

export function fetchWithAppSurface(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
): ReturnType<typeof fetch> {
  return fetch(input, appSurfaceRequestInit(init));
}
