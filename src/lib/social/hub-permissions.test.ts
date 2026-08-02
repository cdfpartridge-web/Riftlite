import { describe, expect, it } from "vitest";

import {
  assertHubMemberRemovalAllowed,
  assertHubMemberRoleChangeAllowed,
  hubCapabilitiesForRole,
  hubRoleHasCapability,
  normalizeHubMemberRole,
} from "@/lib/social/hub-permissions";

describe("private hub co-owner permissions", () => {
  it("keeps existing admin records compatible as co-owners", () => {
    expect(normalizeHubMemberRole("owner")).toBe("owner");
    expect(normalizeHubMemberRole("admin")).toBe("admin");
    expect(normalizeHubMemberRole("unknown")).toBe("member");
  });

  it("gives co-owners every operational capability but not ownership control", () => {
    expect(hubRoleHasCapability("admin", "manage_discord")).toBe(true);
    expect(hubRoleHasCapability("admin", "manage_invites")).toBe(true);
    expect(hubRoleHasCapability("admin", "manage_members")).toBe(true);
    expect(hubRoleHasCapability("admin", "manage_testing_goals")).toBe(true);
    expect(hubRoleHasCapability("admin", "appoint_coowners")).toBe(false);
    expect(hubRoleHasCapability("admin", "transfer_ownership")).toBe(false);
    expect(hubCapabilitiesForRole("member")).toEqual(["view", "participate"]);
  });

  it("allows the owner to appoint and demote co-owners", () => {
    expect(() => assertHubMemberRoleChangeAllowed({
      actorRole: "owner",
      targetRole: "member",
      nextRole: "admin",
      targetIsHubOwner: false,
    })).not.toThrow();
    expect(() => assertHubMemberRoleChangeAllowed({
      actorRole: "owner",
      targetRole: "admin",
      nextRole: "member",
      targetIsHubOwner: false,
    })).not.toThrow();
  });

  it("does not let a co-owner appoint or demote another co-owner", () => {
    expect(() => assertHubMemberRoleChangeAllowed({
      actorRole: "admin",
      targetRole: "member",
      nextRole: "admin",
      targetIsHubOwner: false,
    })).toThrow("Only the hub owner");
    expect(() => assertHubMemberRoleChangeAllowed({
      actorRole: "admin",
      targetRole: "admin",
      nextRole: "member",
      targetIsHubOwner: false,
    })).toThrow("Only the hub owner");
  });

  it("protects the original owner even if a legacy membership has the wrong role", () => {
    expect(() => assertHubMemberRoleChangeAllowed({
      actorRole: "owner",
      targetRole: "member",
      nextRole: "admin",
      targetIsHubOwner: true,
    })).toThrow("hub owner");
    expect(() => assertHubMemberRemovalAllowed({
      actorRole: "admin",
      targetRole: "member",
      targetIsHubOwner: true,
    })).toThrow("hub owner");
  });

  it("lets co-owners remove members but not owners or other co-owners", () => {
    expect(() => assertHubMemberRemovalAllowed({
      actorRole: "admin",
      targetRole: "member",
      targetIsHubOwner: false,
    })).not.toThrow();
    expect(() => assertHubMemberRemovalAllowed({
      actorRole: "admin",
      targetRole: "admin",
      targetIsHubOwner: false,
    })).toThrow("Only the hub owner");
    expect(() => assertHubMemberRemovalAllowed({
      actorRole: "admin",
      targetRole: "owner",
      targetIsHubOwner: false,
    })).toThrow("hub owner");
    expect(() => assertHubMemberRemovalAllowed({
      actorRole: "member",
      targetRole: "member",
      targetIsHubOwner: false,
    })).toThrow("permission");
  });

  it("lets the owner remove a co-owner", () => {
    expect(() => assertHubMemberRemovalAllowed({
      actorRole: "owner",
      targetRole: "admin",
      targetIsHubOwner: false,
    })).not.toThrow();
  });
});
