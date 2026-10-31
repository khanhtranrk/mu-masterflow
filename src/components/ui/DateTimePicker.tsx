import { useCallback, useId, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { DayPicker, useDayPicker, type MonthCaptionProps } from "react-day-picker";
import { Input } from "./Input";
import { SelectField } from "./SelectField";
import { formatLocalDateTime, parseLocalDateTime } from "../../dateTime";
import "react-day-picker/style.css";
import "../../inputs.css";

function CalendarCaption({ calendarMonth }: MonthCaptionProps) {
  const { goToMonth, dayPickerProps } = useDayPicker();
  const date = calendarMonth.date;
  const year = date.getFullYear();
  const first = dayPickerProps.startMonth?.getFullYear() ?? year - 10;
  const last = dayPickerProps.endMonth?.getFullYear() ?? year + 30;
  return <div className="ui-calendar-caption">
    <SelectField label="Calendar month" value={String(date.getMonth())} onValueChange={month => goToMonth(new Date(year, Number(month), 1))} options={Array.from({ length: 12 }, (_, month) => ({ value: String(month), label: new Date(2024, month, 1).toLocaleDateString(undefined, { month: "long" }) }))} />
    <SelectField label="Calendar year" value={String(year)} onValueChange={value => goToMonth(new Date(Number(value), date.getMonth(), 1))} options={Array.from({ length: last - first + 1 }, (_, index) => ({ value: String(first + index), label: String(first + index) }))} />
  </div>;
}

export function DateTimePicker({ value, onValueChange, min, label, disabled = false, name }: {
  value: string; onValueChange: (value: string) => void; min?: string; label: string; disabled?: boolean; name?: string;
}) {
  const [open, setOpen] = useState(false);
  const [container, setContainer] = useState<HTMLElement | undefined>();
  const [draft, setDraft] = useState<Date>(new Date());
  const [month, setMonth] = useState<Date>(new Date());
  const [error, setError] = useState("");
  const errorId = useId();
  const selected = parseLocalDateTime(value);
  const minimum = min ? parseLocalDateTime(min) : undefined;
  const attachTrigger = useCallback((node: HTMLButtonElement | null) => {
    if (node) setContainer(node.closest<HTMLElement>(".desktop-shell, .connection-page, .connection-overlay") ?? undefined);
  }, []);
  function changeOpen(next: boolean) {
    if (next) {
      const initial = selected ?? minimum ?? new Date();
      setDraft(initial); setMonth(initial); setError("");
    }
    setOpen(next);
  }
  function apply() {
    const text = formatLocalDateTime(draft);
    const parsed = parseLocalDateTime(text);
    if (!parsed || (minimum && parsed < minimum)) { setError("Choose a date and time after the minimum allowed time."); return; }
    onValueChange(text); setOpen(false);
  }
  function changeTime(field: "hours" | "minutes", value: string) {
    const next = new Date(draft);
    if (field === "hours") next.setHours(Number(value)); else next.setMinutes(Number(value));
    setDraft(next); setError("");
  }
  return <Popover.Root open={open} onOpenChange={changeOpen}>
    {name && <Input type="hidden" name={name} value={value} />}
    <Popover.Trigger ref={attachTrigger} type="button" disabled={disabled} className="ui-date-trigger" aria-label={label}>
      <span>{selected ? selected.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "No expiration"}</span>
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.4" /><path d="M6 2v4m8-4v4M3 8h14" stroke="currentColor" strokeWidth="1.4" /></svg>
    </Popover.Trigger>
    <Popover.Portal container={container}>
      <Popover.Content className="ui-date-popover" align="start" sideOffset={6} collisionPadding={8} onEscapeKeyDown={event => event.stopPropagation()} aria-label={label}>
        <DayPicker mode="single" required selected={draft} month={month} onMonthChange={setMonth} onSelect={day => { if (day) { const next = new Date(day); next.setHours(draft.getHours(), draft.getMinutes(), 0, 0); setDraft(next); setError(""); } }}
          disabled={minimum ? { before: new Date(minimum.getFullYear(), minimum.getMonth(), minimum.getDate()) } : undefined}
          startMonth={new Date(Math.min(new Date().getFullYear(), draft.getFullYear()), 0, 1)} endMonth={new Date(Math.max(new Date().getFullYear() + 50, draft.getFullYear()), 11, 1)}
          weekStartsOn={1} showOutsideDays components={{ MonthCaption: CalendarCaption }} />
        <div className="ui-date-time"><span>Local time</span><SelectField label="Hour" value={String(draft.getHours())} onValueChange={value => changeTime("hours", value)} options={Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: String(hour).padStart(2, "0") }))} /><span>:</span><SelectField label="Minute" value={String(draft.getMinutes())} onValueChange={value => changeTime("minutes", value)} options={Array.from({ length: 60 }, (_, minute) => ({ value: String(minute), label: String(minute).padStart(2, "0") }))} /></div>
        {error && <p id={errorId} className="ui-date-error" role="alert">{error}</p>}
        <div className="ui-date-actions"><button type="button" onClick={() => { onValueChange(""); setOpen(false); }}>Clear</button><button type="button" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="ui-date-apply" aria-describedby={error ? errorId : undefined} onClick={apply}>Apply</button></div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
