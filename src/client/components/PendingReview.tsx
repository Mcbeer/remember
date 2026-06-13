import { useState } from "react";
import { Check, X, Sparkles, Pencil, Mail, Copy, RefreshCw } from "lucide-react";
import type { Item, Due } from "../api.ts";
import {
  usePendingItems,
  useConfirmPendingItem,
  useRejectPendingItem,
  useInboxAddress,
  useGenerateInboxAddress,
} from "../hooks.ts";
import { formatDue, dueToLocalInput, localInputToDue } from "../datetime.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { cn } from "@/lib/utils.ts";

// The review queue for Email-ingested suggestions (ADR-0005). Suggestions are
// untrusted, so they never appear in the real list — they live here until a
// Member confirms (promoting to a real Item) or rejects (discarding) each one.
//
// Mobile-first: a compact banner at the top of the List opens into stacked
// cards. Each card's Approve/Reject are large, full-width, thumb-reachable
// targets; the title is tappable to edit inline before approving.
export function PendingReview({ listId }: { listId: string }) {
  const pending = usePendingItems(listId);
  const [open, setOpen] = useState(false);

  const rows = pending.data ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="mb-6 overflow-hidden rounded-lg border border-primary/40 bg-primary/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3.5 py-3 text-left text-sm font-medium"
        aria-expanded={open}
      >
        <Sparkles className="size-4 shrink-0 text-primary" />
        <span className="flex-1">
          {rows.length} suggested {rows.length === 1 ? "item" : "items"} from
          email
        </span>
        <span className="text-xs text-muted-foreground">
          {open ? "Hide" : "Review"}
        </span>
      </button>

      {open && (
        <ul className="flex flex-col gap-2 border-t border-primary/20 p-2.5">
          {rows.map((item) => (
            <PendingCard key={item.id} listId={listId} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

// The List's inbound email address (ADR-0005). A toggle that reveals the
// address (minting one on first open if none exists), with copy + regenerate.
// Forwarding/CC-ing mail here turns it into suggested Items for review.
export function InboxAddressButton({ listId }: { listId: string }) {
  const [open, setOpen] = useState(false);
  const address = useInboxAddress(listId, open);
  const generate = useGenerateInboxAddress(listId);
  const [copied, setCopied] = useState(false);

  const current = address.data?.address ?? null;

  async function copy() {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable; the address is still visible to select.
    }
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon-sm"
        title="Email address for this list"
        aria-label="Email address for this list"
        onClick={() => setOpen((v) => !v)}
      >
        <Mail className="size-4" />
      </Button>

      {open && (
        <div className="absolute right-0 z-10 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-3 shadow-md">
          <p className="mb-2 text-xs text-muted-foreground">
            Forward email here to suggest items. They appear as suggestions for
            you to approve.
          </p>

          {address.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : current ? (
            <div className="flex flex-col gap-2">
              <code className="block break-all rounded-md border border-input bg-muted px-2 py-1.5 text-xs">
                {current}
              </code>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={copy}>
                  <Copy className="size-3.5" />
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1 text-muted-foreground"
                  disabled={generate.isPending}
                  onClick={() => {
                    if (
                      confirm(
                        "Generate a new address? The current one will stop working.",
                      )
                    )
                      generate.mutate();
                  }}
                >
                  <RefreshCw className="size-3.5" />
                  New
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              className="w-full"
              disabled={generate.isPending}
              onClick={() => generate.mutate()}
            >
              <Mail className="size-3.5" />
              Generate address
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function PendingCard({ listId, item }: { listId: string; item: Item }) {
  const confirm = useConfirmPendingItem(listId);
  const reject = useRejectPendingItem(listId);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [due, setDue] = useState(item.dueAt ? dueToLocalInput(item.dueAt) : "");

  const busy = confirm.isPending || reject.isPending;

  function approve() {
    // Carry any inline edits through on approval; if nothing changed, the
    // server simply promotes the suggestion as-is.
    const trimmed = title.trim();
    const edits: { title?: string; due?: Due | null } = {};
    if (trimmed && trimmed !== item.title) edits.title = trimmed;
    if (editing) {
      const nextDue = due ? (localInputToDue(due) ?? null) : null;
      const wasDue = item.dueAt ?? null;
      const nextAt = nextDue?.at ?? null;
      if (nextAt !== wasDue) edits.due = nextDue;
    }
    confirm.mutate({
      itemId: item.id,
      edits: Object.keys(edits).length ? edits : undefined,
    });
  }

  return (
    <li className="rounded-md border border-border bg-card p-3">
      {editing ? (
        <div className="flex flex-col gap-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Suggested item title"
            autoFocus
          />
          <Input
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-label="Suggested due date"
            className="w-full"
          />
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="break-words font-medium">{item.title}</span>
            {item.dueAt && (
              <span className="text-xs text-muted-foreground">
                {formatDue(item.dueAt)}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Edit before approving"
            aria-label="Edit before approving"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-4" />
          </Button>
        </div>
      )}

      {/* Full-width, stacked on mobile; side-by-side from sm up. Approve is the
          primary affordance and leads. */}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button
          className={cn("flex-1")}
          disabled={busy}
          onClick={approve}
        >
          <Check className="size-4" />
          Approve
        </Button>
        <Button
          variant="outline"
          className="flex-1 text-muted-foreground hover:text-destructive"
          disabled={busy}
          onClick={() => reject.mutate(item.id)}
        >
          <X className="size-4" />
          Reject
        </Button>
      </div>
    </li>
  );
}
