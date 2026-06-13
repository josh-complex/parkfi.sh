import { useState } from "react";
import { XIcon } from "lucide-react";
import { Button } from "#/components/ui/button.tsx";

/**
 * Two-step confirmation button. The confirming state expands downward so it
 * never causes its column or sibling elements to reflow.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
  variant = "destructive",
  size = "sm",
  icon,
  className,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
  variant?: "destructive" | "outline";
  size?: "sm" | "icon";
  icon?: React.ReactNode;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex flex-col gap-2 animate-in fade-in slide-in-from-top-1 duration-150">
        <p className="text-sm text-muted-foreground">Are you sure?</p>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              await onConfirm();
              setPending(false);
              setConfirming(false);
            }}
          >
            {pending ? "…" : confirmLabel}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            <XIcon />
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button
      size={size}
      variant={variant}
      disabled={disabled}
      onClick={() => setConfirming(true)}
      className={className}
    >
      {icon}
      {label}
    </Button>
  );
}
