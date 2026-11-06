// Menu native macOS untuk panel. Jendela panel hanya setinggi isinya, jadi
// menu HTML akan terpotong; menu native digambar di luar jendela.
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";

export type MenuEntry =
  | "separator"
  | { text: string; enabled?: boolean; checked?: boolean; action: () => void };

export async function popupMenu(anchor: HTMLElement, entries: MenuEntry[]) {
  const items = await Promise.all(
    entries.map((e) => {
      if (e === "separator") return PredefinedMenuItem.new({ item: "Separator" });
      if (e.checked !== undefined)
        return CheckMenuItem.new({ text: e.text, enabled: e.enabled ?? true, checked: e.checked, action: e.action });
      return MenuItem.new({ text: e.text, enabled: e.enabled ?? true, action: e.action });
    }),
  );
  const menu = await Menu.new({ items });
  const r = anchor.getBoundingClientRect();
  await menu.popup(new LogicalPosition(r.left, r.bottom + 4));
}
