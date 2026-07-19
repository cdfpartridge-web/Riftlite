import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  identityUidsFor: vi.fn(),
  leavePrivateHub: vi.fn(),
  deletePrivateHub: vi.fn(),
}));

vi.mock("@/lib/social/server", () => ({
  requireUser: mocks.requireUser,
  identityUidsFor: mocks.identityUidsFor,
  socialJson: (body: Record<string, unknown>, status = 200) => Response.json(body, { status }),
}));

vi.mock("@/lib/social/hub-lifecycle", () => {
  class TestHubLifecycleError extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly status: number,
    ) {
      super(message);
      this.name = "HubLifecycleError";
    }
  }
  return {
    HubLifecycleError: TestHubLifecycleError,
    leavePrivateHub: mocks.leavePrivateHub,
    deletePrivateHub: mocks.deletePrivateHub,
  };
});

import { DELETE as deleteHub } from "@/app/api/hubs/[hubId]/route";
import { DELETE as leaveHub } from "@/app/api/hubs/[hubId]/membership/route";
import { HubLifecycleError } from "@/lib/social/hub-lifecycle";

describe("private hub lifecycle API contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ db: { id: "db" }, decoded: { uid: "account-uid" } });
    mocks.identityUidsFor.mockResolvedValue(["account-uid", "desktop-uid"]);
  });

  it("requires the exact hub id confirmation before deletion", async () => {
    const response = (await deleteHub(request("DELETE", {}), context("hub-a")))!;

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Confirm deletion with the exact hub id.",
      code: "confirmation_required",
    });
    expect(mocks.deletePrivateHub).not.toHaveBeenCalled();
  });

  it("returns a stable successful and idempotent deletion shape", async () => {
    mocks.deletePrivateHub.mockResolvedValue({ hubId: "hub-a", deleted: true, alreadyDeleted: false });
    const response = (await deleteHub(request("DELETE", { confirmation: "hub-a" }), context("hub-a")))!;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      hubId: "hub-a",
      deleted: true,
      alreadyDeleted: false,
    });
    expect(mocks.deletePrivateHub).toHaveBeenCalledWith(
      { id: "db" },
      "hub-a",
      ["account-uid", "desktop-uid"],
    );
  });

  it("surfaces primary-owner authorization as a typed 403", async () => {
    mocks.deletePrivateHub.mockRejectedValue(new HubLifecycleError(
      "Only the primary hub owner can delete this hub.",
      "primary_owner_required",
      403,
    ));
    const response = (await deleteHub(request("DELETE", { confirmation: "hub-a" }), context("hub-a")))!;

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Only the primary hub owner can delete this hub.",
      code: "primary_owner_required",
    });
  });

  it("returns the stable leave shape and owner-must-delete conflict", async () => {
    mocks.leavePrivateHub.mockResolvedValueOnce({ hubId: "hub-a", left: true, alreadyLeft: false });
    const success = (await leaveHub(request("DELETE"), context("hub-a")))!;
    expect(await success.json()).toEqual({
      ok: true,
      hubId: "hub-a",
      left: true,
      alreadyLeft: false,
    });

    mocks.leavePrivateHub.mockRejectedValueOnce(new HubLifecycleError(
      "The primary owner cannot leave their hub. Delete the hub instead.",
      "owner_must_delete",
      409,
    ));
    const conflict = (await leaveHub(request("DELETE"), context("hub-a")))!;
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "owner_must_delete" });
  });
});

function request(method: string, body?: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/hubs/hub-a", {
    method,
    headers: { authorization: "Bearer token", ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function context(hubId: string) {
  return { params: Promise.resolve({ hubId }) };
}
