import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "../hooks";
import type { MenuEntry } from "../menu";
import { Icon } from "./Icon";

interface Props {
  open: boolean;
  anchor: HTMLElement | null;
  /** Elemen `position: relative` tempat menu diletakkan. */
  container: HTMLElement | null;
  entries: MenuEntry[];
  onClose: () => void;
}

/** Menu kaca macOS 26 (Figma S4), muncul dari tombol yang diklik. */
export function Menu({ open, anchor, container, entries, onClose }: Props) {
  const { mounted, state } = usePresence(open, 120);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; origin: number } | null>(null);

  useLayoutEffect(() => {
    if (!mounted || !anchor || !container || !ref.current) return;
    const c = container.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const w = ref.current.offsetWidth;
    const left = Math.round(Math.max(6, Math.min(c.width - w - 6, a.left - c.left)));
    setPos({ left, top: Math.round(a.bottom - c.top + 4), origin: Math.round(a.left - c.left + a.width / 2 - left) });
  }, [mounted, anchor, container]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, anchor, onClose]);

  if (!mounted) return null;
  const style = {
    left: pos?.left ?? 0,
    top: pos?.top ?? 0,
    visibility: pos ? "visible" : "hidden",
    "--origin-x": `${pos?.origin ?? 0}px`,
  } as CSSProperties;

  const node = (
    <div className="menu" ref={ref} role="menu" data-state={state} style={style}>
      {entries.map((e, i) =>
        e === "separator" ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            role={e.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
            aria-checked={e.checked}
            disabled={e.enabled === false}
            onClick={() => {
              onClose();
              e.action();
            }}
          >
            {e.icon ? <Icon name={e.icon} size={14} /> : e.checked !== undefined ? <span className="menu-check">{e.checked && <Icon name="check" size={14} />}</span> : null}
            <span>
              {e.text}
              {e.hint && <small>{e.hint}</small>}
            </span>
          </button>
        ),
      )}
    </div>
  );
  return container ? createPortal(node, container) : node;
}
