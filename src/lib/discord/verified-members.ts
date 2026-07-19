export type DiscordVerifiedMember = {
  discordUserId: string;
  discordUsername: string;
  displayName: string;
  handle: string;
  linkedAt: number;
};

export function formatDiscordVerifiedMembers(
  members: DiscordVerifiedMember[],
  maxLength = 1800,
): string {
  if (!members.length) return "No Discord members have linked a RiftLite account in this server yet.";
  const sorted = [...members].sort((left, right) => (
    left.displayName.localeCompare(right.displayName) || left.discordUsername.localeCompare(right.discordUsername)
  ));
  const lines = [`**Verified and linked RiftLite accounts (${sorted.length})**`];
  let shown = 0;
  for (const member of sorted) {
    const discord = /^\d{5,30}$/.test(member.discordUserId)
      ? `<@${member.discordUserId}>`
      : safeDiscordText(member.discordUsername || "Discord member");
    const displayName = safeDiscordText(member.displayName || member.handle || "RiftLite player");
    const handle = safeDiscordText(member.handle.replace(/^@+/, ""));
    const linked = member.linkedAt > 0 ? ` · linked <t:${Math.floor(member.linkedAt / 1000)}:d>` : "";
    const line = `• ${discord} → ${displayName}${handle ? ` (@${handle})` : ""}${linked}`;
    const remaining = sorted.length - shown - 1;
    const suffix = remaining > 0 ? `\n…and ${remaining} more.` : "";
    if ([...lines, line].join("\n").length + suffix.length > maxLength) break;
    lines.push(line);
    shown += 1;
  }
  if (shown < sorted.length) lines.push(`…and ${sorted.length - shown} more.`);
  return lines.join("\n");
}

function safeDiscordText(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/[<>*_`~|]/g, "").trim().slice(0, 80);
}
