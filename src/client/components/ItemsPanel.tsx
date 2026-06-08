import { useState } from "react";
import type { Item } from "../api.ts";
import {
  useItems,
  useCreateItem,
  useToggleItem,
  useEditItem,
  useDeleteItem,
} from "../hooks.ts";
import { localInputToDue, formatDue, isOverdue, dueToLocalInput } from "../datetime.ts";
import { SchedulesSection } from "./SchedulesSection.tsx";

export function ItemsPanel({
  listId,
  listName,
}: {
  listId: string;
  listName: string;
}) {
  const items = useItems(listId);
  const createItem = useCreateItem(listId);
  const toggleItem = useToggleItem(listId);
  const deleteItem = useDeleteItem(listId);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    await createItem.mutateAsync({
      title: trimmed,
      due: localInputToDue(due) ?? undefined,
    });
    setTitle("");
    setDue("");
  }

  const rows = items.data ?? [];

  return (
    <div className="items-panel">
      <h2>{listName}</h2>

      <form className="add-item" onSubmit={add}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add an item…"
          aria-label="New item title"
        />
        <input
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          aria-label="Due date and time"
          title="Optional due date"
        />
        <button className="btn btn-primary" disabled={createItem.isPending}>
          Add
        </button>
      </form>

      {items.isLoading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No items yet.</p>
      ) : (
        <ul className="items">
          {rows.map((item) => (
            <ItemRow
              key={item.id}
              listId={listId}
              item={item}
              onToggle={() => toggleItem.mutate(item)}
              onDelete={() => deleteItem.mutate(item.id)}
            />
          ))}
        </ul>
      )}

      <SchedulesSection listId={listId} />
    </div>
  );
}

function ItemRow({
  listId,
  item,
  onToggle,
  onDelete,
}: {
  listId: string;
  item: Item;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const editItem = useEditItem(listId);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [due, setDue] = useState(item.dueAt ? dueToLocalInput(item.dueAt) : "");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    await editItem.mutateAsync({
      itemId: item.id,
      patch: {
        title: trimmed,
        due: due ? localInputToDue(due) : null,
      },
    });
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="item editing">
        <form className="edit-item" onSubmit={save}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Item title"
            autoFocus
          />
          <input
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-label="Due date and time"
          />
          <div className="edit-actions">
            <button className="btn btn-primary small" disabled={editItem.isPending}>
              Save
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="item">
      <label className="item-main">
        <input
          type="checkbox"
          checked={item.completed === 1}
          onChange={onToggle}
        />
        <span className="item-text">
          <span className={item.completed === 1 ? "done" : ""}>
            {item.title}
          </span>
          {item.dueAt && (
            <span
              className={
                isOverdue(item.dueAt) && item.completed === 0
                  ? "due overdue"
                  : "due"
              }
            >
              {formatDue(item.dueAt)}
            </span>
          )}
        </span>
      </label>
      <div className="item-actions">
        <button
          className="icon-btn"
          title="Edit item"
          onClick={() => setEditing(true)}
        >
          ✎
        </button>
        <button className="icon-btn" title="Delete item" onClick={onDelete}>
          ×
        </button>
      </div>
    </li>
  );
}
