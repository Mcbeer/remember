import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Menu } from "lucide-react";
import type { Me } from "../api.ts";
import { useLists, useFamilies } from "../hooks.ts";
import { Button } from "@/components/ui/button.tsx";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { ItemsPanel } from "./ItemsPanel.tsx";
import { PushPrompt } from "./PushPrompt.tsx";

export function Home({ me }: { me: Me }) {
  const lists = useLists();
  const families = useFamilies();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const qc = useQueryClient();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    qc.clear();
    window.location.reload();
  }

  // Default selection to the first List once loaded.
  const selected = selectedId ?? (lists.data && lists.data[0]?.id) ?? null;

  // On mobile, picking a List should dismiss the drawer.
  function select(id: string) {
    setSelectedId(id);
    setDrawerOpen(false);
  }

  const sidebar = (
    <Sidebar
      lists={lists.data ?? []}
      families={families.data ?? []}
      loading={lists.isLoading || families.isLoading}
      selectedId={selected}
      onSelect={select}
    />
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
          >
            <Menu />
          </Button>
          <span className="font-semibold tracking-tight">Remember</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {me.name ?? me.email}
          </span>
          <Button variant="outline" size="sm" onClick={logout}>
            Sign out
          </Button>
        </div>
      </header>

      <PushPrompt />

      <div className="flex min-h-0 flex-1">
        {/* Persistent sidebar on md+ */}
        <aside className="hidden w-64 shrink-0 border-r border-border bg-card md:block">
          {sidebar}
        </aside>

        {/* Drawer sidebar on mobile */}
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent side="left" className="md:hidden">
            <SheetTitle className="sr-only">Lists</SheetTitle>
            {sidebar}
          </SheetContent>
        </Sheet>

        <main className="min-w-0 flex-1 overflow-y-auto">
          {selected ? (
            <ItemsPanel
              listId={selected}
              listName={lists.data?.find((l) => l.id === selected)?.name ?? ""}
            />
          ) : (
            <div className="grid h-full place-items-center p-4 text-center text-muted-foreground">
              {lists.isLoading ? "Loading…" : "Create a list to get started."}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
