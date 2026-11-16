// Ikon 16 px dari file Figma Docky (komponen Ikon/*). Digambar sebagai mask CSS
// supaya warnanya mengikuti `color` (misalnya oranye untuk Bersih brutal).
import arrow from "../assets/icons/arrow.svg";
import bolt from "../assets/icons/bolt.svg";
import check from "../assets/icons/check.svg";
import chevron from "../assets/icons/chevron.svg";
import close from "../assets/icons/close.svg";
import collapse from "../assets/icons/collapse.svg";
import dock from "../assets/icons/dock.svg";
import error from "../assets/icons/error.svg";
import gear from "../assets/icons/gear.svg";
import grip from "../assets/icons/grip.svg";
import info from "../assets/icons/info.svg";
import layers from "../assets/icons/layers.svg";
import menu from "../assets/icons/menu.svg";
import play from "../assets/icons/play.svg";
import plus from "../assets/icons/plus.svg";
import refresh from "../assets/icons/refresh.svg";
import search from "../assets/icons/search.svg";
import sliders from "../assets/icons/sliders.svg";
import success from "../assets/icons/success.svg";
import trash from "../assets/icons/trash.svg";
import undo from "../assets/icons/undo.svg";
import warning from "../assets/icons/warning.svg";

const ICONS = {
  arrow, bolt, check, chevron, close, collapse, dock, error, gear, grip, info, layers,
  menu, play, plus, refresh, search, sliders, success, trash, undo, warning,
} as const;

export type IconName = keyof typeof ICONS;

interface Props {
  name: IconName;
  /** Redupkan (opacity 0.6), seperti ikon header di Figma. */
  dim?: boolean;
  size?: number;
  className?: string;
}

export function Icon({ name, dim, size = 16, className }: Props) {
  const url = `url("${ICONS[name]}")`;
  return (
    <span
      className={["icon", dim ? "dim" : "", className ?? ""].join(" ").trim()}
      style={{ width: size, height: size, WebkitMaskImage: url, maskImage: url }}
      aria-hidden
    />
  );
}
