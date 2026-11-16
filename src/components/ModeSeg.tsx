import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { MODE_LABEL, MODES, type PresetMode } from "../api";
import { Icon, type IconName } from "./Icon";

export const MODE_ICON: Record<PresetMode, IconName> = { clean: "sliders", brutal: "bolt", dock_only: "dock" };

interface Props {
  mode: PresetMode | null;
  onChange: (m: PresetMode) => void;
  disabled?: boolean;
}

/**
 * Pilihan mode seperti segmented control macOS. Bagian aktif adalah salinan
 * yang dipotong dengan clip-path; saat mode berganti potongannya bergeser,
 * jadi latar putih dan warna teks berpindah bersamaan.
 */
export function ModeSeg({ mode, onChange, disabled }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  const [clip, setClip] = useState<{ l: number; r: number } | null>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const el = layer.current;
    const item = el?.querySelector<HTMLElement>(`[data-mode="${mode}"]`);
    if (!el || !item) return setClip(null);
    setClip({ l: item.offsetLeft - el.offsetLeft, r: el.offsetWidth - (item.offsetLeft - el.offsetLeft) - item.offsetWidth });
  }, [mode]);

  // Posisi pertama tanpa animasi; setelah itu baru bergeser.
  useLayoutEffect(() => {
    if (clip && !ready) requestAnimationFrame(() => setReady(true));
  }, [clip, ready]);

  const content = (m: PresetMode) => (
    <>
      <Icon name={MODE_ICON[m]} size={13} />
      {MODE_LABEL[m]}
    </>
  );

  return (
    <div className="seg" role="radiogroup" aria-label="Mode">
      <div className="seg-layer" ref={layer}>
        {MODES.map(({ mode: m, hint }) => (
          <button
            key={m}
            data-mode={m}
            role="radio"
            aria-checked={mode === m}
            className={`seg-item${m === "brutal" ? " brutal" : ""}`}
            disabled={disabled}
            title={hint}
            onClick={() => onChange(m)}
          >
            {content(m)}
          </button>
        ))}
      </div>
      {clip && (
        <div
          className="seg-thumb"
          aria-hidden
          style={
            {
              "--clip-left": `${clip.l}px`,
              "--clip-right": `${clip.r}px`,
              transitionDuration: ready ? undefined : "0ms",
              opacity: disabled ? 0.6 : 1,
            } as CSSProperties
          }
        >
          <div className="seg-layer">
            {MODES.map(({ mode: m }) => (
              <span key={m} className={`seg-item${m === "brutal" ? " brutal" : ""}`}>
                {content(m)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
