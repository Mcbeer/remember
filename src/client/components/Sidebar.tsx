import { useMemo, useState } from "react";
import type { Family, List } from "../api.ts";
import {
  useCreateList,
  useDeleteList,
  useCreateFamily,
} from "../hooks.ts";
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
    <aside className="sidebar">
      {loading && <div className="muted">Loading…</div>}

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

      <button className="btn add-family" onClick={addFamily}>
        + New family
      </button>
    </aside>
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
    <div className="section">
      <div className="sidebar-label">{title}</div>
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
  if (lists.length === 0) return <p className="muted empty">No lists yet.</p>;
  return (
    <ul className="list-nav">
      {lists.map((l) => (
        <li
          key={l.id}
          className={
            l.id === selectedId ? "list-nav-item active" : "list-nav-item"
          }
        >
          <button className="list-nav-btn" onClick={() => onSelect(l.id)}>
            {l.name}
          </button>
          <button
            className="icon-btn"
            title="Delete list"
            onClick={() => {
              if (confirm(`Delete "${l.name}" and its items?`)) onDelete(l.id);
            }}
          >
            ×
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
      className="add-list"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(name);
        setName("");
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New list…"
        aria-label="New list name"
      />
      <button className="btn">Add</button>
    </form>
  );
}
