import { useContext, useState } from "react";
import { ChatContext } from "@/features/chat/chatContext";
import segments from "@/nara/segments.json";

export interface ReadySegment {
  id: string;
  label: string;
  description: string;
  audioUrl?: string;
  text: string;
}

export function QuickSegmentsBar() {
  const { chat: bot } = useContext(ChatContext);
  const [expanded, setExpanded] = useState(false);

  const items = segments as ReadySegment[];

  return (
    <div className="mb-1.5 flex flex-wrap items-center justify-center gap-1.5">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="rounded-full border border-white/20 bg-slate-900/75 px-3 py-1 text-[11px] font-semibold text-slate-100 shadow backdrop-blur-md hover:bg-slate-800/90"
        title="Tampilkan atau sembunyikan segmen MC siap putar (tanpa jeda LLM)"
      >
        {expanded ? "Tutup Segmen MC ▾" : "Segmen Siap Putar ▴"}
      </button>

      {expanded &&
        items.map((seg) => (
          <button
            key={seg.id}
            type="button"
            onClick={() => bot.speakDirect(seg.text, { audioUrl: seg.audioUrl })}
            title={seg.description}
            className="rounded-full border border-sky-400/40 bg-sky-900/80 px-3 py-1 text-[11px] font-semibold text-sky-100 shadow backdrop-blur-md hover:bg-sky-700/90 active:scale-95 transition"
          >
            ▶ {seg.label}
          </button>
        ))}
    </div>
  );
}
