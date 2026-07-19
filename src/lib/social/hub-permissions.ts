export type HubMemberRole = "owner" | "admin" | "member";

export type HubCapability =
  | "view"
  | "participate"
  | "manage_content"
  | "manage_invites"
  | "manage_members"
  | "manage_discord"
  | "manage_testing_goals"
  | "appoint_coowners"
  | "transfer_ownership";

const HUB_ROLE_CAPABILITIES: Record<HubMemberRole, ReadonlySet<HubCapability>> = {
  owner: new Set<HubCapability>([
    "view",
    "participate",
    "manage_content",
    "manage_invites",
    "manage_members",
    "manage_discord",
    "manage_testing_goals",
    "appoint_coowners",
    "transfer_ownership",
  ]),
  admin: new Set<HubCapability>([
    "view",
    "participate",
    "manage_content",
    "manage_invites",
    "manage_members",
    "manage_discord",
    "manage_testing_goals",
  ]),
  member: new Set<HubCapability>(["view", "participate"]),
};

export function normalizeHubMemberRole(value: unknown): HubMemberRole {
  return value === "owner" || value === "admin" ? value : "member";
}

export function hubRoleHasCapability(role: HubMemberRole, capability: HubCapability): boolean {
  return HUB_ROLE_CAPABILITIES[role].has(capability);
}

export function hubCapabilitiesForRole(role: HubMemberRole): HubCapability[] {
  return Array.from(HUB_ROLE_CAPABILITIES[role]);
}

export function assertHubMemberRoleChangeAllowed(input: {
  actorRole: HubMemberRole;
  targetRole: HubMemberRole;
  nextRole: Exclude<HubMemberRole, "owner">;
  targetIsHubOwner: boolean;
}): void {
  if (input.targetIsHubOwner || input.targetRole === "owner") {
    throw new Error("The hub owner cannot be demoted or replaced here.");
  }
  if (input.actorRole !== "owner") {
    throw new Error("Only the hub owner can appoint or remove co-owners.");
  }
}

export function assertHubMemberRemovalAllowed(input: {
  actorRole: HubMemberRole;
  targetRole: HubMemberRole;
  targetIsHubOwner: boolean;
}): void {
  if (input.targetIsHubOwner || input.targetRole === "owner") {
    throw new Error("The hub owner cannot be removed.");
  }
  if (input.actorRole !== "owner" && input.targetRole === "admin") {
    throw new Error("Only the hub owner can remove a co-owner.");
  }
  if (input.actorRole !== "owner" && input.actorRole !== "admin") {
    throw new Error("You do not have permission for this hub action.");
  }
}
