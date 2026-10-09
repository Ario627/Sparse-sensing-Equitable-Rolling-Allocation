import type { SessionUserResponse } from "@sera/contracts";
import { redirect } from "@tanstack/react-router";
import { restoreSession } from "@/lib/api/client.ts";
import { type SessionSnapshot, useSessionStore } from "./session-store.ts";

function isSessionLive(state: SessionSnapshot): boolean {
  return (
    state.user !== null &&
    state.accessToken !== null &&
    state.expiresAt !== null &&
    Date.now() < state.expiresAt
  );
}

export async function ensureSession(): Promise<SessionUserResponse | null> {
  const state = useSessionStore.getState();
  if (isSessionLive(state)) {
    return state.user;
  }
  const restored = await restoreSession();
  return restored ? useSessionStore.getState().user : null;
}

export async function requireSession(href: string): Promise<SessionUserResponse> {
  const user = await ensureSession();
  if (user === null) {
    throw redirect({ to: "/login", search: { redirect: href } });
  }
  return user;
}
