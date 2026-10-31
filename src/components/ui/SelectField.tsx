import { useCallback, useState } from "react";
import * as Select from "@radix-ui/react-select";
import "../../dropdowns.css";

export type SelectOption = { value: string; label: string; disabled?: boolean };
export function SelectField({ value, onValueChange, options, label, disabled, className = "", placeholder = "Choose…" }: {
  value: string; onValueChange: (value: string) => void; options: SelectOption[];
  label: string; disabled?: boolean; className?: string; placeholder?: string;
}) {
  const [container, setContainer] = useState<HTMLElement | undefined>(undefined);
  const attachTrigger = useCallback((node: HTMLButtonElement | null) => {
    if (node) setContainer(node.closest<HTMLElement>(".desktop-shell, .connection-page, .connection-overlay") ?? undefined);
  }, []);
  return <Select.Root value={value} onValueChange={onValueChange} disabled={disabled}>
    <Select.Trigger ref={attachTrigger} className={`ui-select-trigger ${className}`} aria-label={label}>
      <Select.Value placeholder={placeholder} /><Select.Icon className="ui-select-icon"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></Select.Icon>
    </Select.Trigger>
    <Select.Portal container={container}>
      <Select.Content className="ui-dropdown-content ui-select-content" position="popper" sideOffset={5} collisionPadding={8} onEscapeKeyDown={event => event.stopPropagation()}>
        <Select.ScrollUpButton className="ui-select-scroll" aria-label="Scroll up">⌃</Select.ScrollUpButton>
        <Select.Viewport className="ui-select-viewport">
          {options.map(option => <Select.Item className="ui-dropdown-item ui-select-item" value={option.value} key={option.value} disabled={option.disabled} textValue={option.label}>
            <Select.ItemText>{option.label}</Select.ItemText><Select.ItemIndicator className="ui-select-check">✓</Select.ItemIndicator>
          </Select.Item>)}
        </Select.Viewport>
        <Select.ScrollDownButton className="ui-select-scroll" aria-label="Scroll down">⌄</Select.ScrollDownButton>
      </Select.Content>
    </Select.Portal>
  </Select.Root>;
}
