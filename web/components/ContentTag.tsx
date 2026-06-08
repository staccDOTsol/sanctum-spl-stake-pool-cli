import clsx from "clsx";
import type { ContentTag } from "@/lib/types";

const TAG_STYLES: Record<ContentTag, string> = {
  Hot:              "bg-orange-500/20 text-orange-300 border-orange-500/30",
  Rising:           "bg-green-500/20 text-green-300 border-green-500/30",
  Contested:        "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  "Almost Leaked":  "bg-green-400/20 text-green-200 border-green-400/40",
  Suppressed:       "bg-red-500/20 text-red-300 border-red-500/30",
  New:              "bg-blue-500/20 text-blue-300 border-blue-500/30",
};

const TAG_ICONS: Record<ContentTag, string> = {
  Hot:              "🔥",
  Rising:           "↑",
  Contested:        "⚔",
  "Almost Leaked":  "🔓",
  Suppressed:       "🔒",
  New:              "✦",
};

interface Props {
  tag: ContentTag;
  size?: "sm" | "md";
}

export default function ContentTagBadge({ tag, size = "sm" }: Props) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border font-mono font-semibold tracking-wide",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
        TAG_STYLES[tag]
      )}
    >
      <span>{TAG_ICONS[tag]}</span>
      {tag.toUpperCase()}
    </span>
  );
}
