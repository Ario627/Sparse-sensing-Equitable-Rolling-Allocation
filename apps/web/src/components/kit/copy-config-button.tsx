import { useState } from "react";
import { cn } from "@/lib/cn.ts";
import { copyText } from "@/lib/clipboard.ts";
import { Button } from "./button.tsx";
import { textareaClass } from "./field.tsx";

const DEFAULT_LABEL = "Salin konfigurasi";
const COPIED_NOTE = "Konfigurasi tersalin.";
const MANUAL_NOTE =
  "Penyalinan otomatis tidak tersedia di peramban ini. Salin dari kotak di bawah.";
const TEXTAREA_ROWS = 12;

type CopyState = "idle" | "copied" | "manual";

export interface CopyConfigButtonProps {
  readonly text: string;
  readonly label?: string;
  readonly className?: string;
}

export function CopyConfigButton({
  text,
  label = DEFAULT_LABEL,
  className,
}: CopyConfigButtonProps) {
  const [state, setState] = useState<CopyState>("idle");

  async function handleClick(): Promise<void> {
    const ok = await copyText(text);
    setState(ok ? "copied" : "manual");
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void handleClick();
          }}
        >
          {label}
        </Button>
        {state === "copied" && (
          <span className="text-xs text-ok">{COPIED_NOTE}</span>
        )}
      </div>
      {state === "manual" && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-ink-3">{MANUAL_NOTE}</p>
          <textarea
            readOnly
            value={text}
            rows={TEXTAREA_ROWS}
            spellCheck={false}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
            className={cn(textareaClass, "font-mono text-xs")}
          />
        </div>
      )}
    </div>
  );
}
