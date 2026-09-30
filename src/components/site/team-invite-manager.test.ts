import { createElement } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { User } from "firebase/auth";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TeamInviteManager, type PendingTeamInvite } from "./team-invite-manager";

const user = { uid: "owner-a", getIdToken: vi.fn(async () => "owner-token") } as unknown as User;
const endpoint = "/api/teams/team-a/invites";
const invite: PendingTeamInvite = {
  inviteId: "invite-a", teamId: "team-a", teamName: "Example Team", senderName: "Owner",
  targetHandle: "player", status: "open", expiresAt: Date.now() + 86_400_000,
};
const url = "https://www.riftlite.com/teams/invite/invite-a";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("team invite management", () => {
  it("only reads invitations until an owner deliberately sends or creates one", async () => {
    const fetchMock = requests();
    const view = render(createElement(TeamInviteManager, { user, teamId: "team-a" }));
    await view.findByText("No pending invitations.");
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(["GET"]);
    expect(view.getByRole("button", { name: "Send invite" })).toBeDisabled();
    fireEvent.change(view.getByRole("textbox", { name: "RiftLite handle" }), { target: { value: "@@" } });
    expect(view.getByRole("button", { name: "Send invite" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends a handle invitation and refreshes pending invitations", async () => {
    const fetchMock = requests();
    const view = render(createElement(TeamInviteManager, { user, teamId: "team-a" }));
    await view.findByText("No pending invitations.");
    fireEvent.change(view.getByRole("textbox", { name: "RiftLite handle" }), { target: { value: " @player " } });
    fireEvent.click(view.getByRole("button", { name: "Send invite" }));
    await view.findByText("Invitation sent to @player. They can join from My Teams, or you can share this link.");
    expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({
      method: "POST", headers: { Authorization: "Bearer owner-token", "Content-Type": "application/json" },
      body: JSON.stringify({ targetHandle: "@player" }),
    }));
    expect(view.getByRole("textbox", { name: "Invite link" })).toHaveValue(url);
    expect(view.getByRole("textbox", { name: "RiftLite handle" })).toHaveValue("");
    expect(await view.findByRole("button", { name: "Cancel invite" })).toBeEnabled();
  });

  it("creates a single-use link, falls back to manual copy, and cancels that link", async () => {
    const fetchMock = requests();
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Clipboard denied")) } });
    const view = render(createElement(TeamInviteManager, { user, teamId: "team-a" }));
    await view.findByText("No pending invitations.");
    fireEvent.click(view.getByRole("button", { name: "Create invite link" }));
    await view.findByText("Link ready. Share it with one person you want to invite.");
    expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: "POST", body: JSON.stringify({ targetHandle: "" }) }));
    fireEvent.click(view.getByRole("button", { name: "Copy link" }));
    await view.findByText("Select the link below and copy it to share.");
    expect(view.getByRole("textbox", { name: "Invite link" })).toHaveValue(url);
    await waitFor(() => expect(view.getByRole("button", { name: "Cancel invite" })).toBeEnabled());
    fireEvent.click(view.getByRole("button", { name: "Cancel invite" }));
    await view.findByText("Invitation cancelled. Its link can no longer be used.");
    expect(fetchMock).toHaveBeenCalledWith(`${endpoint}/invite-a`, expect.objectContaining({ method: "DELETE" }));
    expect(view.queryByRole("textbox", { name: "Invite link" })).not.toBeInTheDocument();
    expect(view.queryByRole("button", { name: "Cancel invite" })).not.toBeInTheDocument();
  });

  it("copies a generated link when clipboard permission is available", async () => {
    requests();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const view = render(createElement(TeamInviteManager, { user, teamId: "team-a" }));
    await view.findByText("No pending invitations.");
    fireEvent.click(view.getByRole("button", { name: "Create invite link" }));
    fireEvent.click(await view.findByRole("button", { name: "Copy link" }));
    await view.findByText("Invite link copied.");
    expect(writeText).toHaveBeenCalledWith(url);
  });

  it("ignores an old create response after its account/team component unmounts", async () => {
    const pending = deferred<Response>();
    const fetchMock = requests(pending.promise);
    const view = render(createElement(TeamInviteManager, { user, teamId: "team-a" }));
    await view.findByText("No pending invitations.");
    fireEvent.click(view.getByRole("button", { name: "Create invite link" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    view.unmount();
    const next = render(createElement(TeamInviteManager, { user, teamId: "team-b" }));
    await next.findByText("No pending invitations.");
    await act(async () => pending.resolve(Response.json({ invite, inviteUrl: url })));
    expect(next.queryByRole("textbox", { name: "Invite link" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([path, init]) => path === endpoint && init?.method === "GET")).toHaveLength(1);
  });
});

function requests(createResponse?: Promise<Response>) {
  let created = false;
  const fetchMock = vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "GET") return Response.json({ invites: created && path === endpoint ? [invite] : [] });
    if (init?.method === "POST" && path === endpoint) {
      created = true;
      return createResponse ?? Response.json({ invite, inviteUrl: url });
    }
    if (init?.method === "DELETE" && path === `${endpoint}/invite-a`) return Response.json({ ok: true });
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
