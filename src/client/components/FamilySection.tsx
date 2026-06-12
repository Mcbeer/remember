import { useState } from "react";
import { Share2, LogOut, Users } from "lucide-react";
import type { Family, List } from "../api.ts";
import { useGenerateInvite, useLeaveFamily, useFamilyMembers } from "../hooks.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { ListNav, AddListForm, SectionLabel } from "./Sidebar.tsx";

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
  const [showMembers, setShowMembers] = useState(false);
  // Only fetch the roster once the User opens it (lazy).
  const members = useFamilyMembers(family.id, showMembers);

  // Mint a fresh invite secret, show it, and copy to the clipboard. Used on
  // first open and by the explicit "Regenerate" button (which invalidates the
  // previous secret server-side).
  async function generate() {
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

  // The header button toggles the invite panel. Closing just hides it (the
  // secret stays valid); reopening reuses the existing link rather than minting
  // a new one. Only generate on the very first open.
  function toggleInvite() {
    if (inviteLink) {
      setInviteLink(null);
    } else {
      void generate();
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
    <div className="mb-4">
      <div className="flex items-center justify-between">
        <SectionLabel>{family.name}</SectionLabel>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            title="Members"
            aria-label="Show members"
            aria-expanded={showMembers}
            onClick={() => setShowMembers((v) => !v)}
          >
            <Users className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Invite link"
            aria-label="Show invite link"
            aria-expanded={!!inviteLink}
            onClick={toggleInvite}
          >
            <Share2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Leave family"
            aria-label="Leave family"
            onClick={leave}
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>

      {inviteLink && (
        <div className="my-2 flex flex-col gap-2 rounded-md border border-border bg-accent/40 p-2.5">
          <div className="text-xs text-muted-foreground">
            {copied ? "Link copied — " : ""}share to invite (expires in 7 days):
          </div>
          <Input
            readOnly
            value={inviteLink}
            onFocus={(e) => e.target.select()}
            className="h-8 text-xs"
          />
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={generate}
          >
            Regenerate
          </Button>
        </div>
      )}

      {showMembers && (
        <div className="my-2 rounded-md border border-border bg-accent/40 p-2.5">
          {members.isLoading && (
            <div className="text-xs text-muted-foreground">Loading members…</div>
          )}
          {members.isError && (
            <div className="text-xs text-destructive">
              Couldn’t load members.
            </div>
          )}
          {members.data && (
            <ul className="flex flex-col gap-1.5">
              {members.data.map((m) => (
                <li key={m.userId} className="flex items-center gap-2">
                  {m.avatarUrl ? (
                    <img
                      src={m.avatarUrl}
                      alt=""
                      className="size-6 shrink-0 rounded-full"
                    />
                  ) : (
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium uppercase text-muted-foreground">
                      {(m.name ?? m.email).charAt(0)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {m.name ?? m.email}
                  </span>
                </li>
              ))}
            </ul>
          )}
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
