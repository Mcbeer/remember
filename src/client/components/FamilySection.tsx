import { useState } from "react";
import { Share2, LogOut } from "lucide-react";
import type { Family, List } from "../api.ts";
import { useGenerateInvite, useLeaveFamily } from "../hooks.ts";
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
    <div className="mb-4">
      <div className="flex items-center justify-between">
        <SectionLabel>{family.name}</SectionLabel>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            title="Invite link"
            aria-label="Create invite link"
            onClick={invite}
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
            onClick={invite}
          >
            Regenerate
          </Button>
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
