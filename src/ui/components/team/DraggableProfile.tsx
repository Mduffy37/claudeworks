import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Profile } from "../../../electron/types";

interface Props {
  profile: Profile;
  inTeam: boolean;
  onAdd?: () => void;
}

export function DraggableProfile({ profile, inTeam, onAdd }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: `avail-${profile.name}`,
    disabled: inTeam,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: inTeam ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`te-avail-item${inTeam ? " in-team" : ""}`}
    >
      <div
        className="te-avail-grip"
        aria-hidden="true"
        {...(inTeam ? {} : { ...attributes, ...listeners })}
        title={inTeam ? undefined : "Drag to add to team"}
      >
        <span /><span /><span /><span /><span /><span />
      </div>
      <div className="te-avail-text">
        <div className="te-avail-name">{profile.name}</div>
        <div className="te-avail-meta">
          {inTeam ? "In team \u2713" : `${profile.plugins.length} plugin${profile.plugins.length !== 1 ? "s" : ""}`}
        </div>
      </div>
      {!inTeam && onAdd && (
        <button
          type="button"
          className="te-avail-add"
          onClick={onAdd}
          aria-label={`Add ${profile.name} to team`}
          title="Add to team"
        >
          +
        </button>
      )}
    </div>
  );
}
