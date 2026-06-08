import { useState } from "react";
import type { Family, List } from "../api.ts";
import { useGenerateInvite, useLeaveFamily } from "../hooks.ts";
import { ListNav, AddListForm } from "./Sidebar.tsx";

export function FamilySection({
  family,
  lists,
  selectedId,
  onSelect,
  onDeleteList,
  onAddList,
}: {
  family: Family;
  lists: List[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDeleteList: (id: string) => void;
  onAddList: (name: string) => void;
}) {
  const generateInvite = useGenerateInvite();
  const leaveFamily = useLeaveFamily();
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function invite() {
    const { secret } = await generateInvite.mutateAsync(family.id);
    const link = `${window.location.origin}/join/${secret}`;
    setInviteLink(link);
    setCopied(false);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // clipboard may be blocked; the link is shown for manual copy
    }
  }

  function leave() {
    if (
      confirm(
        `Leave "${family.name}"? If you're the last member, its lists are deleted.`,
      )
    ) {
      leaveFamily.mutate(family.id);
    }
  }

  return (
    <div className="section">
      <div className="family-header">
        <span className="sidebar-label">{family.name}</span>
        <div className="family-actions">
          <button className="icon-btn" title="Invite link" onClick={invite}>
            ↗
          </button>
          <button className="icon-btn" title="Leave family" onClick={leave}>
            ⎋
          </button>
        </div>
      </div>

      {inviteLink && (
        <div className="invite-box">
          <div className="muted small">
            {copied ? "Link copied — " : ""}share to invite (expires in 7 days):
          </div>
          <input readOnly value={inviteLink} onFocus={(e) => e.target.select()} />
          <button className="btn small" onClick={invite}>
            Regenerate
          </button>
        </div>
      )}

      <ListNav
        lists={lists}
        selectedId={selectedId}
        onSelect={onSelect}
        onDelete={onDeleteList}
      />
      <AddListForm onAdd={onAddList} />
    </div>
  );
}
