"use client";

// =============================================================================
// Composer — the single input for both conversation and document creation.
// =============================================================================
// Mode is a VISIBLE segmented control, not a hidden slash command:
//   [ Chat ] [ Document ]     (Document reveals a format picker)
// Enter sends; Shift+Enter adds a line break. While a reply streams, the
// send button becomes Stop (aborts the fetch; the already-streamed text is
// discarded — the server persists only complete replies).
// =============================================================================

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { ArrowUp, FileSpreadsheet, FileText, Loader2, Presentation, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ComposerMode = "chat" | "document";
export type DocFormat = "docx" | "pdf" | "xlsx" | "pptx";

const FORMATS: Array<{
  id: DocFormat;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  chip: string;
}> = [
  { id: "docx", label: "Word", hint: "Documents & reports", icon: FileText, chip: "text-[#2b579a]" },
  { id: "pdf", label: "PDF", hint: "Print-ready files", icon: FileText, chip: "text-[#c8102e]" },
  { id: "xlsx", label: "Excel", hint: "Spreadsheets & models", icon: FileSpreadsheet, chip: "text-[#1d6f42]" },
  { id: "pptx", label: "PowerPoint", hint: "Slide decks", icon: Presentation, chip: "text-[#d24726]" },
];

export function Composer({
  mode,
  onModeChange,
  format,
  onFormatChange,
  onSend,
  onStop,
  streaming,
  busy,
  disabled,
  autoFocusKey,
  placeholder,
  preset,
}: {
  mode: ComposerMode;
  onModeChange: (m: ComposerMode) => void;
  format: DocFormat;
  onFormatChange: (f: DocFormat) => void;
  onSend: (message: string) => void;
  onStop: () => void;
  streaming: boolean;
  busy: boolean;
  disabled?: boolean;
  /** Changes when the empty-state example prompts fill the input (refocus). */
  autoFocusKey?: number;
  placeholder?: string;
  /** External text fill (example prompt clicked) — applied when `preset.key` changes. */
  preset?: { text: string; key: number };
}) {
  const [value, setValue] = useState("");
  const [lastPreset, setLastPreset] = useState(preset);
  const ref = useRef<HTMLTextAreaElement>(null);

  // External preset (example prompt click) fills the input — render-time
  // state adjustment, the React-endorsed alternative to an effect.
  if (preset && preset.key !== lastPreset?.key) {
    setLastPreset(preset);
    setValue(preset.text);
  }

  // …and focuses it (a DOM side effect — legitimately an effect).
  useEffect(() => {
    if (preset) ref.current?.focus();
  }, [preset?.key]);

  // Auto-grow textarea up to a sane ceiling.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);

  // External fill (example prompt click) focuses the input.
  useEffect(() => {
    if (autoFocusKey !== undefined) ref.current?.focus();
  }, [autoFocusKey]);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = value.trim();
    if (!text || disabled || busy || streaming) return;
    onSend(text);
    setValue("");
    requestAnimationFrame(() => ref.current?.focus());
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  const activeFormat = FORMATS.find((f) => f.id === format) ?? FORMATS[0];

  return (
    <form
      onSubmit={submit}
      className={cn(
        "rounded-2xl border bg-card shadow-lg shadow-black/[0.03] transition-colors focus-within:border-primary/50",
        disabled && "opacity-60"
      )}
    >
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder={
          placeholder ??
          (mode === "document"
            ? "Describe the document — I'll use our conversation as context…"
            : "Ask anything, research a topic, draft an idea…")
        }
        className="max-h-[200px] w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/70"
        aria-label="Message"
      />

      <div className="flex items-center gap-1.5 px-2.5 pb-2.5 pt-1">
        {/* Mode segmented control */}
        <div
          className="flex items-center rounded-lg bg-muted p-0.5"
          role="tablist"
          aria-label="Composer mode"
        >
          <ModeTab active={mode === "chat"} onClick={() => onModeChange("chat")}>
            <MessageIcon className="mr-1 size-3.5" /> Chat
          </ModeTab>
          <ModeTab active={mode === "document"} onClick={() => onModeChange("document")}>
            <FileText className="mr-1 size-3.5" /> Document
          </ModeTab>
        </div>

        {/* Format picker (document mode only) */}
        {mode === "document" ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors hover:bg-accent"
                aria-label={`Output format: ${activeFormat.label}`}
              >
                <activeFormat.icon className={cn("size-3.5", activeFormat.chip)} />
                {activeFormat.label}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              {FORMATS.map((f) => (
                <DropdownMenuItem key={f.id} onClick={() => onFormatChange(f.id)}>
                  <f.icon className={cn("mr-2 size-4", f.chip)} />
                  <span className="mr-auto">{f.label}</span>
                  <span className="text-xs text-muted-foreground">{f.hint}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        <div className="flex-1" />

        <span className="mr-1 hidden text-[11px] text-muted-foreground sm:block">
          <kbd className="rounded border bg-muted px-1 py-px text-[10px]">Enter</kbd> to send
        </span>

        {streaming ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onStop}
                className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background transition-transform hover:scale-105"
                aria-label="Stop generating"
              >
                <Square className="size-3.5 fill-current" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Stop generating</TooltipContent>
          </Tooltip>
        ) : (
          <button
            type="submit"
            disabled={!value.trim() || disabled || busy}
            className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-all hover:brightness-110 disabled:opacity-40"
            aria-label="Send message"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </button>
        )}
      </div>
    </form>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors",
        active ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function MessageIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}
