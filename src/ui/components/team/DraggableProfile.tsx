import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Profile } from "../../../electron/types";

export function DraggableProfile({ profile, inTeam }: { profile: Profile; inTeam: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: `avail-${profile.name}`,
    disabled: inTeam,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: inTeam ? 0.4 : 1,
    cursor: inTeam ? "default" : "grab",
  };

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, pointerEvents: inTeam ? "none" : undefined }}
      {...(inTeam ? {} : { ...attributes, ...listeners })}
      className={`te-avail-item${inTeam ? " in-team" : ""}`}
    >
      <div className="te-avail-name">{profile.name}</div>
      <div className="te-avail-meta">
        {inTeam ? "In team \u2713" : `${profile.plugins.length} plugin${profile.plugins.length !== 1 ? "s" : ""}`}
      </div>
    </div>
  );
}
