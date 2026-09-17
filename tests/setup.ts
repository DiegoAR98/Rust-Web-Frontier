import '@colyseus/testing'; // installs waitForMessage on the Room prototypes
import { Room as ClientRoom } from '@colyseus/sdk';

/**
 * Closes a race that failed a random integration file on roughly one run in
 * five.
 *
 * The SDK drops any message that arrives before a handler for its type is
 * registered -- `dispatchMessage` emits to nobody and warns. WorldRoom.onJoin
 * defers its `session`, `inventory`, `vitals` and `crafting` sends by one
 * clock tick (50ms) precisely so a test has a moment to bind its handlers
 * after `await colyseus.connectTo(...)`, which normally takes microseconds.
 * But a full run has ~20 Colyseus servers competing for one machine, and when
 * the event loop stalls past that tick the join messages land first and are
 * thrown away: a `waitForMessage` then blocks until it times out, and a
 * persistent `onMessage` counter stays empty. Raising the timeout does not
 * help -- verified at 15s. The message is early, not late.
 *
 * So a message with no handler at all is held instead of discarded, and
 * replayed to a persistent `onMessage` listener when one binds -- that
 * listener is asking for everything the room sends, so a frame that reached
 * nobody belongs to it.
 *
 * `waitForMessage` is deliberately NOT fed from that buffer, with one
 * exception. It means "the next frame after now", and tests rely on that:
 * world-room.hit-node arms two inventory waits before gathering and would
 * otherwise be handed the empty join frame and see no wood at all. The
 * exception is `session`, which is sent exactly once per join and so has no
 * "next" to confuse it with. tests/integration/testing-harness.test.ts proves
 * both halves.
 */
interface BufferingRoom {
  __undelivered?: Map<string, unknown[]>;
  getMessageHandlerKey(type: string): string;
  onMessageHandlers: { events: Record<string, unknown> };
}

type Proto = Record<string, (...args: never[]) => unknown>;
const proto = ClientRoom.prototype as unknown as Proto;

/** Pulls the oldest held frame of a type, if one was dropped earlier. */
function takeBuffered(room: BufferingRoom, type: string): { message: unknown } | undefined {
  const key = room.getMessageHandlerKey(type);
  const pending = room.__undelivered?.get(key);
  if (!pending || pending.length === 0) return undefined;
  const message = pending.shift();
  if (pending.length === 0) room.__undelivered!.delete(key);
  return { message };
}

const originalDispatch = proto.dispatchMessage;
proto.dispatchMessage = function (this: BufferingRoom, ...args: never[]) {
  const type = args[0] as unknown as string;
  const key = this.getMessageHandlerKey(type);
  const listening = Boolean(this.onMessageHandlers.events[key] ?? this.onMessageHandlers.events['*']);
  if (!listening && !String(key).startsWith('__')) {
    (this.__undelivered ??= new Map()).set(key, [
      ...(this.__undelivered.get(key) ?? []),
      args[1] as unknown,
    ]);
    return undefined;
  }
  return originalDispatch.apply(this, args);
} as typeof originalDispatch;

const originalOnMessage = proto.onMessage;
proto.onMessage = function (this: BufferingRoom, ...args: never[]) {
  const unbind = originalOnMessage.apply(this, args);
  const callback = args[1] as unknown as (message: unknown) => void;
  let held = takeBuffered(this, args[0] as unknown as string);
  while (held) {
    const { message } = held;
    // Asynchronously, so a handler registered at connect time still sees the
    // join frames arrive after its own registration returns.
    setTimeout(() => callback(message), 0);
    held = takeBuffered(this, args[0] as unknown as string);
  }
  return unbind;
} as typeof originalOnMessage;

const originalWait = proto.waitForMessage as unknown as (
  type: string,
  rejectTimeout?: number,
) => Promise<unknown>;
proto.waitForMessage = async function (this: BufferingRoom, type: string, rejectTimeout?: number) {
  // Only `session`: see the note above on why every other type has to keep
  // waiting for a genuinely new frame.
  if (type === 'session') {
    const held = takeBuffered(this, type);
    if (held) return held.message;
  }
  return originalWait.call(this, type, rejectTimeout);
} as unknown as typeof proto.waitForMessage;
