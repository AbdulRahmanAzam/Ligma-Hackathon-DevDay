/** Tiny API helper module shared by Login + Home + room flows. */

import type { SummaryData } from "./ai-summary";

export interface SessionUser {
  user_id: string;
  display: string;
  email: string;
  role: "Lead" | "Contributor" | "Viewer";
  color?: string;
}

export interface RoomCard {
  room_id: string;
  name: string;
  owner_id: string;
  default_role: "Lead" | "Contributor" | "Viewer";
  created_at: number;
  my_role: "Lead" | "Contributor" | "Viewer" | null;
  member_count: number;
  last_seq: number | null;
  last_at: string | null;
}

export interface InviteInfo {
  room_id: string;
  room_name: string;
  role: "Contributor" | "Viewer";
  expires_at: number;
}

const ROLE_DEFAULT_COLOR: Record<string, string> = {
  Lead: "#0ea5e9",
  Contributor: "#f97316",
  Viewer: "#22c55e",
};

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export function resolveApiUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (!API_BASE) return url;
  const base = API_BASE.replace(/\/+$/, "");
  if (!url) return base;
  return url.startsWith("/") ? `${base}${url}` : `${base}/${url}`;
}

export function persistSession(token: string, user: SessionUser, color?: string): void {
  const c = color ?? user.color ?? ROLE_DEFAULT_COLOR[user.role] ?? "#0ea5e9";
  window.localStorage.setItem("ligma.token", token);
  window.localStorage.setItem("ligma.userId", user.user_id);
  window.localStorage.setItem("ligma.userName", user.display);
  window.localStorage.setItem("ligma.userColor", c);
  window.localStorage.setItem("ligma.userRole", user.role);
}

export function clearSession(): void {
  window.localStorage.removeItem("ligma.token");
  window.localStorage.removeItem("ligma.userId");
  window.localStorage.removeItem("ligma.userName");
  window.localStorage.removeItem("ligma.userColor");
  window.localStorage.removeItem("ligma.userRole");
}

export function readToken(): string | null {
  return window.localStorage.getItem("ligma.token");
}

export function readUser(): SessionUser | null {
  const id = window.localStorage.getItem("ligma.userId");
  const display = window.localStorage.getItem("ligma.userName");
  const role = window.localStorage.getItem("ligma.userRole") as SessionUser["role"] | null;
  if (!id || !display || !role) return null;
  return { user_id: id, display, email: "", role };
}

async function jsonFetch<T>(
  url: string,
  opts: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (opts.auth) {
    const t = readToken();
    if (t) headers["authorization"] = `Bearer ${t}`;
  }
  const r = await fetch(resolveApiUrl(url), { ...opts, headers });
  const ct = r.headers.get("content-type") ?? "";
  const body = ct.includes("application/json") ? await r.json() : await r.text();
  if (!r.ok) {
    const msg =
      typeof body === "object" && body && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return body as T;
}

// --- auth ---

export async function signIn(
  email: string,
  password: string,
): Promise<{ token: string; user: SessionUser }> {
  return jsonFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function signUp(
  email: string,
  password: string,
  display: string,
): Promise<{ token: string; user: SessionUser }> {
  return jsonFetch("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, display }),
  });
}

// --- rooms ---

export async function listMyRooms(): Promise<RoomCard[]> {
  return jsonFetch("/api/me/rooms", { auth: true });
}

export async function createRoom(
  name: string,
  default_role: "Contributor" | "Viewer",
): Promise<{ room_id: string; name: string; default_role: string; owner_id: string }> {
  return jsonFetch("/api/rooms", {
    method: "POST",
    auth: true,
    body: JSON.stringify({ name, default_role }),
  });
}

// --- invites ---

export async function createInvite(
  room_id: string,
  role: "Contributor" | "Viewer",
): Promise<{ token: string; role: string; room_id: string; expires_at: number }> {
  return jsonFetch(`/api/rooms/${encodeURIComponent(room_id)}/invites`, {
    method: "POST",
    auth: true,
    body: JSON.stringify({ role }),
  });
}

export async function readInvite(token: string): Promise<InviteInfo> {
  return jsonFetch(`/api/invites/${encodeURIComponent(token)}`);
}

export async function acceptInvite(token: string): Promise<{ room_id: string; role: string }> {
  return jsonFetch("/api/invites/accept", {
    method: "POST",
    auth: true,
    body: JSON.stringify({ token }),
  });
}

// --- room admin (Lead-only) ---

export interface RoomMember {
  user_id: string;
  role: "Lead" | "Contributor" | "Viewer";
  display: string;
  email: string;
}

export interface RoomDetail {
  room_id: string;
  name: string;
  owner_id: string;
  default_role: "Lead" | "Contributor" | "Viewer";
  created_at: number;
  members: RoomMember[];
}

export async function getRoom(room_id: string): Promise<RoomDetail> {
  return jsonFetch(`/api/rooms/${encodeURIComponent(room_id)}`, { auth: true });
}

export async function removeMember(room_id: string, user_id: string): Promise<void> {
  await jsonFetch(
    `/api/rooms/${encodeURIComponent(room_id)}/members/${encodeURIComponent(user_id)}`,
    { method: "DELETE", auth: true },
  );
}

export interface ActiveInvite {
  token: string;
  role: "Contributor" | "Viewer";
  created_at: number;
  expires_at: number;
  redeemed_count: number;
}

export async function listInvites(room_id: string): Promise<ActiveInvite[]> {
  return jsonFetch(`/api/rooms/${encodeURIComponent(room_id)}/invites`, { auth: true });
}

export async function revokeInvite(room_id: string, token: string): Promise<void> {
  await jsonFetch(
    `/api/rooms/${encodeURIComponent(room_id)}/invites/${encodeURIComponent(token)}`,
    { method: "DELETE", auth: true },
  );
}

// --- ai summary ---

export async function requestAiSummary(
  summary: SummaryData,
): Promise<{ markdown: string }> {
  return jsonFetch("/api/ai/summary", {
    method: "POST",
    auth: true,
    body: JSON.stringify({ summary }),
  });
}
