import { useCallback, useState, type ReactElement } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import "../../dropdowns.css";

export type MenuAction = { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean; separator?: boolean };
export function ActionMenu({ trigger, actions, open, onOpenChange, label }: {
  trigger: ReactElement; actions: MenuAction[]; open?: boolean; onOpenChange?: (open: boolean) => void; label: string;
}) {
  const [container, setContainer] = useState<HTMLElement | undefined>(undefined);
  const attachTrigger = useCallback((node: HTMLButtonElement | null) => {
    if (node) setContainer(node.closest<HTMLElement>(".desktop-shell, .connection-page, .connection-overlay") ?? undefined);
  }, []);
  return <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
    <DropdownMenu.Trigger asChild ref={attachTrigger}>{trigger}</DropdownMenu.Trigger>
    <DropdownMenu.Portal container={container}>
      <DropdownMenu.Content className="ui-dropdown-content ui-action-menu" align="end" sideOffset={5} collisionPadding={8} onEscapeKeyDown={event => event.stopPropagation()} aria-label={label}>
        {actions.map(action => <MenuItem key={action.label} action={action} />)}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
function MenuItem({ action }: { action: MenuAction }) {
  return <>{action.separator && <DropdownMenu.Separator className="ui-dropdown-separator" />}<DropdownMenu.Item className={`ui-dropdown-item ${action.danger ? "ui-dropdown-danger" : ""}`} disabled={action.disabled} onSelect={action.onSelect}>{action.label}</DropdownMenu.Item></>;
}
