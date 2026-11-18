// Event carrying the extras the interaction tests assert (key, composing state).
// A factory (usable with `new`) so the instance always belongs to the currently
// installed DOM implementation, regardless of module evaluation order.
export function FakeEvent(type, init = {}) {
  const event = new (globalThis.Event)(type, { bubbles: init.bubbles ?? true, cancelable: true, composed: true });
  if (init.key !== undefined) Object.defineProperty(event, "key", { value: init.key });
  if (init.isComposing !== undefined) Object.defineProperty(event, "isComposing", { value: init.isComposing });
  return event;
}
