// Shared, reviewable slash-command definitions. Server installations only.
const existingCommands = [
  {
    name: "verify",
    description: "Link your Discord account to your RiftLite profile.",
  },
  {
    name: "verified",
    description: "List Discord members linked to RiftLite in this server.",
    default_member_permissions: "32",
  },
  {
    name: "setup",
    description: "Connect this Discord server to a RiftLite private hub.",
    default_member_permissions: "32",
    options: [
      {
        name: "hub_id",
        description: "RiftLite private hub id.",
        type: 3,
        required: true,
      },
      {
        name: "verified_role",
        description: "Role to assign after RiftLite verification.",
        type: 8,
        required: false,
      },
      {
        name: "feed_channel",
        description: "Channel reserved for the RiftLite match feed.",
        type: 7,
        required: false,
        channel_types: [0, 5],
      },
      {
        name: "reports_channel",
        description: "Channel for reports and opted-in replay links.",
        type: 7,
        required: false,
        channel_types: [0, 5],
      },
    ],
  },
  {
    name: "recent",
    description: "Show recent matches from the connected RiftLite hub.",
    options: [
      {
        name: "count",
        description: "Number of matches to show.",
        type: 4,
        required: false,
        min_value: 1,
        max_value: 10,
      },
    ],
  },
  {
    name: "leaderboard",
    description: "Show the RiftLite testing contribution leaderboard.",
    options: [
      {
        name: "range_days",
        description: "Stats window in days.",
        type: 4,
        required: false,
        min_value: 1,
        max_value: 30,
      },
    ],
  },
  {
    name: "weekly-report",
    description: "Show or post a RiftLite weekly testing report.",
    options: [
      {
        name: "post",
        description: "Post to the configured reports channel instead of this channel.",
        type: 5,
        required: false,
      },
    ],
  },
  {
    name: "testing-goals",
    description: "Manage RiftLite hub testing goals.",
    options: [
      {
        name: "list",
        description: "List active testing goals.",
        type: 1,
      },
      {
        name: "add",
        description: "Add a testing goal.",
        type: 1,
        options: [
          {
            name: "text",
            description: "Goal text.",
            type: 3,
            required: true,
            max_length: 240,
          },
        ],
      },
      {
        name: "complete",
        description: "Mark a testing goal complete.",
        type: 1,
        options: [
          {
            name: "id",
            description: "Goal id shown by /testing-goals list.",
            type: 3,
            required: true,
          },
        ],
      },
    ],
  },
];

export const discordCommands = [
  { name: "help", description: "How to install, connect and use RiftLite Results Bot." },
  { name: "status", description: "Privately check this server's RiftLite connection.", default_member_permissions: "32" },
  { name: "disconnect", description: "Disconnect this server from its RiftLite hub without deleting results.", default_member_permissions: "32" },
  ...existingCommands.map(command => command.name === "setup" ? {
    ...command,
    options: command.options.filter(option => option.name !== "feed_channel"),
  } : command),
].map(command => ({ ...command, integration_types: [0], contexts: [0] }));

export function commandsForScope({ guild = false } = {}) {
  return discordCommands.map(command => {
    if (!guild) return structuredClone(command);
    // Discord defines these context fields only for globally registered commands.
    const { integration_types, contexts, ...guildCommand } = command;
    void integration_types;
    void contexts;
    return structuredClone(guildCommand);
  });
}