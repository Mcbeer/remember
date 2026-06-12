import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { Family, List } from "../api.ts";
import { useCreateList, useDeleteList, useCreateFamily } from "../hooks.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { FamilySection } from "./FamilySection.tsx";

export function Sidebar({
  lists,
  families,
  loading,
  selectedId,
  onSelect,
}: {
  lists: List[];
  families: Family[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const createList = useCreateList();
  const deleteList = useDeleteList();
  const createFamily = useCreateFamily();

  // Partition visible lists by owner.
  const { personal, byFamily } = useMemo(() => {
    const personal: List[] = [];
    const byFamily = new Map<string, List[]>();
    for (const l of lists) {
      if (l.ownerFamilyId) {
        const arr = byFamily.get(l.ownerFamilyId) ?? [];
        arr.push(l);
        byFamily.set(l.ownerFamilyId, arr);
      } else {
        personal.push(l);
      }
    }
    return { personal, byFamily };
  }, [lists]);

  async function addList(familyId: string | undefined, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const list = await createList.mutateAsync({ name: trimmed, familyId });
    onSelect(list.id);
  }

  async function addFamily() {
    const name = prompt("Name your family (e.g. The Smiths):")?.trim();
    if (name) await createFamily.mutateAsync(name);
  }

  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto p-3">
      {loading && (
        <div className="px-1 text-sm text-muted-foreground">Loading…</div>
      )}

      {/* Personal */}
      <Section title="Personal">
        <ListNav
          lists={personal}
          selectedId={selectedId}
          onSelect={onSelect}
          onDelete={(id) => deleteList.mutate(id)}
        />
        <AddListForm onAdd={(name) => addList(undefined, name)} />
      </Section>

      {/* One section per Family */}
      {families.map((fam) => (
        <FamilySection
          key={fam.id}
          family={fam}
          lists={byFamily.get(fam.id) ?? []}
          selectedId={selectedId}
          onSelect={onSelect}
          onDeleteList={(id) => deleteList.mutate(id)}
          onAddList={(name) => addList(fam.id, name)}
        />
      ))}

      <Button
        variant="outline"
        size="sm"
        className="mt-auto w-full"
        onClick={addFamily}
      >
        + New family
      </Button>
    </div>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <SectionLabel>{title}</SectionLabel>
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

export function ListNav({
  lists,
  selectedId,
  onSelect,
  onDelete,
}: {
  lists: List[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (lists.length === 0)
    return (
      <p className="my-1 text-sm text-muted-foreground">No lists yet.</p>
    );
  return (
    <ul className="flex flex-col gap-0.5">
      {lists.map((l) => (
        <li
          key={l.id}
          className={
            "group flex items-center rounded-md " +
            (l.id === selectedId ? "bg-accent" : "hover:bg-accent/50")
          }
        >
          <button
            className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm"
            onClick={() => onSelect(l.id)}
          >
            {l.name}
          </button>
          <button
            className="shrink-0 rounded-md p-2 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
            title="Delete list"
            aria-label={`Delete ${l.name}`}
            onClick={() => {
              if (confirm(`Delete "${l.name}" and its items?`)) onDelete(l.id);
            }}
          >
            <X className="size-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function AddListForm({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(name);
        setName("");
      }}
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New list…"
        aria-label="New list name"
        className="h-9"
      />
      <Button type="submit" size="sm" variant="secondary">
        Add
      </Button>
    </form>
  );
}
