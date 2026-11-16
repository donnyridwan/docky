import { MODE_DOT, MODE_LABEL, type Preset } from "../api";
import { Icon } from "./Icon";

interface Props {
  presets: Preset[];
  activeId?: string;
  onSelect: (p: Preset) => void;
  /** Tombol + di ujung tab: preset baru (kosong atau dari kondisi sekarang). */
  onNew: (anchor: HTMLElement) => void;
  disabled?: boolean;
  newOpen?: boolean;
}

/** Preset sebagai tab folder seperti Chrome (Figma K1 dan Pengaturan S1). */
export function PresetTabs({ presets, activeId, onSelect, onNew, disabled, newOpen }: Props) {
  return (
    <div className="tabs" role="tablist" aria-label="Preset">
      {presets.map((p) => {
        const active = p.id === activeId;
        return (
          <button
            key={p.id}
            role="tab"
            aria-selected={active}
            className={`tab${active ? " active" : ""}`}
            disabled={disabled && !active}
            onClick={() => onSelect(p)}
            title={`${p.name} · ${MODE_LABEL[p.mode]}`}
          >
            <span className="tab-dot" style={{ background: MODE_DOT[p.mode] }} aria-hidden />
            <span className="tab-name">{p.name}</span>
          </button>
        );
      })}
      <button
        className="tab-new"
        aria-label="Preset baru"
        aria-haspopup="menu"
        aria-expanded={newOpen}
        title="Preset baru"
        disabled={disabled}
        onClick={(e) => onNew(e.currentTarget)}
      >
        <Icon name="plus" size={15} />
      </button>
    </div>
  );
}
