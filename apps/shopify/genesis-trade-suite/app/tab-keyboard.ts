import type { KeyboardEvent } from "react";

export function handleTabKeyboard(event: KeyboardEvent<HTMLElement>) {
  const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
  const index = tabs.indexOf(event.currentTarget);
  const destination = event.key === "ArrowRight" ? (index + 1) % tabs.length
    : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
    : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : undefined;
  if (destination === undefined || !tabs[destination]) return;
  event.preventDefault();
  tabs[destination].focus();
  tabs[destination].click();
}
