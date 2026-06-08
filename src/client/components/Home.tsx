import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Me } from "../api.ts";
import { useLists, useFamilies } from "../hooks.ts";
import { Sidebar } from "./Sidebar.tsx";
import { ItemsPanel } from "./ItemsPanel.tsx";

export function Home({ me }: { me: Me }) {
  const lists = useLists();
  const families = useFamilies();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const qc = useQueryClient();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    qc.clear();
    window.location.reload();
  }

  // Default selection to the first List once loaded.
  const selected =
    selectedId ?? (lists.data && lists.data[0]?.id) ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <strong>Remember</strong>
        <div className="topbar-right">
          <span className="muted">{me.name ?? me.email}</span>
          <button className="btn" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <div className="layout">
        <Sidebar
          lists={lists.data ?? []}
          families={families.data ?? []}
          loading={lists.isLoading || families.isLoading}
          selectedId={selected}
          onSelect={setSelectedId}
        />
        <main className="content">
          {selected ? (
            <ItemsPanel
              listId={selected}
              listName={
                lists.data?.find((l) => l.id === selected)?.name ?? ""
              }
            />
          ) : (
            <div className="centered muted">
              {lists.isLoading
                ? "Loading…"
                : "Create a list to get started."}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
