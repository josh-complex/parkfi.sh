"use client";

import * as React from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { Calendar } from "#/components/ui/calendar.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import { cn } from "#/lib/utils.ts";

/**
 * Controlled single-date picker — a `Calendar` in a `Popover` behind a button
 * trigger (the shadcn pattern, adapted to our base-ui Popover/Button). Selecting
 * a day fires `onChange` and closes the popover. Pass `fromDate`/`toDate` to bound
 * the selectable range (days outside are disabled and the view starts at `fromDate`).
 */
export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  id,
  className,
  fromDate,
  toDate,
  dateFormat = "PPP",
}: {
  value?: Date;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  id?: string;
  className?: string;
  fromDate?: Date;
  toDate?: Date;
  /** date-fns format for the trigger label; "PP" for a short-month variant. */
  dateFormat?: string;
}) {
  const [open, setOpen] = React.useState(false);

  const disabled = [
    ...(fromDate ? [{ before: fromDate }] : []),
    ...(toDate ? [{ after: toDate }] : []),
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            data-empty={!value}
            className={cn(
              "w-full justify-start text-left font-normal data-[empty=true]:text-muted-foreground",
              className,
            )}
          />
        }
      >
        <CalendarIcon className="size-4" />
        {value ? format(value, dateFormat) : <span>{placeholder}</span>}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          autoFocus
          selected={value}
          onSelect={(d) => {
            onChange(d);
            if (d) setOpen(false);
          }}
          startMonth={fromDate}
          endMonth={toDate}
          disabled={disabled.length ? disabled : undefined}
        />
      </PopoverContent>
    </Popover>
  );
}
