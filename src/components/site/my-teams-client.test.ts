import { createElement } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { User } from "firebase/auth";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/site/riftlite-auth-panel", () => ({ RiftLiteAuthPanel: () => null }));
vi.mock("@/lib/firebase/client", () => ({ firebaseClientApp: {} }));

import { MyTeamsAccount } from "./my-teams-client";

const user = { uid: "account-a", email: "player@example.com", getIdToken: vi.fn(async () => "account-token") } as unknown as User;
const teamsPath = "/api/teams?mine=1&limit=80";
const invite = { inviteId: "invite-a", teamId: "team-a", teamName: "Example Team", senderName: "Owner", targetHandle: "player", status: "open", expiresAt: Date.now() + 86_400_000 };
const team = { id: "team-a", name: "Example Team", slug: "private-team", visibility: "private", memberCount: 2 };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("My Teams invitation inbox", () => {
  it("only reads until Join team is clicked, then refreshes membership and opens the team", async () => {
    const fetchMock = requests();
    const view = render(createElement(MyTeamsAccount, { user, onSignOut: vi.fn() }));
    await view.findByRole("button", { name: "Join team" });
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
    expect(view.getByText("Signed in as player@example.com.")).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Join team" }));
    await view.findByText("You joined Example Team.");
    expect(fetchMock).toHaveBeenCalledWith("/api/teams/invites/accept", expect.objectContaining({
      method: "POST", body: JSON.stringify({ inviteId: invite.inviteId }),
      headers: { Authorization: "Bearer account-token", "Content-Type": "application/json" },
    }));
    expect(await view.findByText(/Your role: member/)).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Open team" })).toBeInTheDocument();
    expect(view.queryByRole("button", { name: "Join team" })).not.toBeInTheDocument();
    expect(view.queryByRole("link", { name: /Example Team/ })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([path]) => path === teamsPath)).toHaveLength(2);
  });

  it("declines an invite only on click without loading private team details", async () => {
    const fetchMock = requests();
    const view = render(createElement(MyTeamsAccount, { user, onSignOut: vi.fn() }));
    fireEvent.click(await view.findByRole("button", { name: "Decline" }));
    await view.findByText("Invitation declined.");
    expect(fetchMock).toHaveBeenCalledWith("/api/teams/invites/decline", expect.objectContaining({ method: "POST", body: JSON.stringify({ inviteId: invite.inviteId }) }));
    expect(view.queryByRole("button", { name: "Join team" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([path]) => path === "/api/teams/team-a")).toBe(false);
  });

  it("offers account switching without acting on invitations", async () => {
    const fetchMock = requests();
    const onSignOut = vi.fn();
    const view = render(createElement(MyTeamsAccount, { user, onSignOut }));
    await view.findByRole("button", { name: "Join team" });
    fireEvent.click(view.getByRole("button", { name: "Use a different account" }));
    expect(onSignOut).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("ignores a completed Join request after the account component unmounts", async () => {
    const pending = deferred<Response>();
    const fetchMock = requests({ acceptResponse: pending.promise });
    const view = render(createElement(MyTeamsAccount, { user, onSignOut: vi.fn() }));
    fireEvent.click(await view.findByRole("button", { name: "Join team" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    view.unmount();
    await act(async () => pending.resolve(Response.json({ ok: true, team })));
    expect(fetchMock.mock.calls.filter(([path]) => path === teamsPath)).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([path]) => path === "/api/teams/team-a")).toBe(false);
  });

  it("closes a cached team when refreshing shows membership was removed", async () => {
    let teamReads = 0;
    requests({ teams: () => ++teamReads === 1 ? [team] : [] });
    const view = render(createElement(MyTeamsAccount, { user, onSignOut: vi.fn() }));
    fireEvent.click(await view.findByRole("button", { name: "Open team" }));
    await view.findByText(/Your role: member/);
    fireEvent.click(view.getByRole("button", { name: "Refresh teams" }));
    await view.findByText("No teams yet");
    expect(view.queryByText(/Your role: member/)).not.toBeInTheDocument();
    expect(view.queryByRole("button", { name: "Close team" })).not.toBeInTheDocument();
  });

  it("refreshes the selected role and removes invite tools after an admin is demoted", async () => {
    let detailReads = 0;
    requests({ teams: () => [team], role: () => ++detailReads === 1 ? "admin" : "member" });
    const view = render(createElement(MyTeamsAccount, { user, onSignOut: vi.fn() }));
    fireEvent.click(await view.findByRole("button", { name: "Open team" }));
    await view.findByRole("region", { name: "Invite member" });
    fireEvent.click(view.getByRole("button", { name: "Refresh teams" }));
    await view.findByText(/Your role: member/);
    expect(view.queryByRole("region", { name: "Invite member" })).not.toBeInTheDocument();
    expect(detailReads).toBe(2);
  });
});

function requests(options: { acceptResponse?: Promise<Response>; teams?: () => typeof team[]; role?: () => string } = {}) {
  let joined = false;
  let responded = false;
  const fetchMock = vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
    if (path === teamsPath) return Response.json({ teams: options.teams ? options.teams() : joined ? [team] : [] });
    if (path === "/api/teams/invites") return Response.json({ invites: responded ? [] : [invite] });
    if (path === "/api/teams/invites/accept" && init?.method === "POST") {
      joined = true; responded = true;
      return options.acceptResponse ?? Response.json({ ok: true, team });
    }
    if (path === "/api/teams/invites/decline" && init?.method === "POST") { responded = true; return Response.json({ ok: true }); }
    if (path === "/api/teams/team-a") return Response.json({ team, myRole: options.role?.() ?? "member", members: [{ uid: "account-a", displayName: "Example Player", handle: "player", role: "member" }] });
    if (path === "/api/teams/team-a/invites") return Response.json({ invites: [] });
    throw new Error(`Unexpected request: ${String(path)} ${init?.method}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
