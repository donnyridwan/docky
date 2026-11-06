// Ikon 16 px dari file Figma Docky (komponen Ikon/*), disertakan apa adanya sebagai SVG.
import check from "../assets/icons/check.svg";
import chevron from "../assets/icons/chevron.svg";
import close from "../assets/icons/close.svg";
import collapse from "../assets/icons/collapse.svg";
import dock from "../assets/icons/dock.svg";
import layers from "../assets/icons/layers.svg";
import menu from "../assets/icons/menu.svg";
import play from "../assets/icons/play.svg";
import plus from "../assets/icons/plus.svg";
import sliders from "../assets/icons/sliders.svg";
import undo from "../assets/icons/undo.svg";

const ICONS = { check, chevron, close, collapse, dock, layers, menu, play, plus, sliders, undo } as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, dim, className }: { name: IconName; dim?: boolean; className?: string }) {
  return (
    <img
      className={["icon", dim ? "dim" : "", className ?? ""].join(" ").trim()}
      src={ICONS[name]}
      width={16}
      height={16}
      alt=""
      draggable={false}
    />
  );
}
