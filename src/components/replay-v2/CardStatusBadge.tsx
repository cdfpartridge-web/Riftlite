import { ArrowUp, Ban, ChevronsUp, Hourglass, MoveRight, Shield, ShieldPlus, Skull, Sword, Tag, Zap } from "lucide-react";

import { cardStatusText, type CardStatus } from "./card-status";
import styles from "./ReplayV2Player.module.css";

const icons = {
  buff: ArrowUp, disarm: Ban, deflect: ShieldPlus, deathknell: Skull,
  shield: Shield, stunned: Zap, tank: Shield, empowered: ChevronsUp,
  ganking: MoveRight, assault: Sword, temporary: Hourglass, custom: Tag,
};

export function CardStatusBadge({ status, preview = false }: { status: CardStatus; preview?: boolean }) {
  const Glyph = icons[status.kind];
  const text = cardStatusText(status);
  return (
    <span
      aria-label={text}
      className={`${preview ? styles.hoverDuplicateTag : styles.duplicateTag} ${styles.cardStatusBadge}`}
      data-card-status={preview ? undefined : status.kind}
      data-card-custom-label={preview ? undefined : status.sourceLabel}
      data-hover-card-status={preview ? status.kind : undefined}
      data-hover-card-custom-label={preview ? status.sourceLabel : undefined}
      data-status-kind={status.kind}
      title={text}
    >
      <Glyph aria-hidden="true" />
      <span>{status.label}</span>
      {status.count !== undefined ? <b>{status.count}</b> : null}
    </span>
  );
}
