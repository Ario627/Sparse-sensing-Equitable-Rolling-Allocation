import type { AuthSessionResponse, SessionUserResponse, UserRole } from "@sera/contracts";
import { create } from "zustand";

export interface SessionSnapshot {
  readonly user: SessionUserResponse | null;
  readonly accessToken: string | null;
  readonly expiresAt: number | null;
}

const anonymousSnapshot: SessionSnapshot = {
  user: null,
  accessToken: null,
  expiresAt: null,
};

export const useSessionStore = create<SessionSnapshot>(() => anonymousSnapshot);

export function setSession(session: AuthSessionResponse): void {
  useSessionStore.setState({
    user: session.user,
    accessToken: session.access_token,
    expiresAt: Date.now() + session.expires_in * 1_000,
  });
}

export function clearSession(): void {
  useSessionStore.setState(anonymousSnapshot);
}

export function readAccessToken(): string | null {
  return useSessionStore.getState().accessToken;
}

export function useRole(): UserRole | null {
  return useSessionStore((snapshot) => snapshot.user?.role ?? null);
}

export function readExpiresAt(): number | null {
  return useSessionStore.getState().expiresAt;
}
