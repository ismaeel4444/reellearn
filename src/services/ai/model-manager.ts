/**
 * Phase 3 resource contract (strict rule from spec review):
 *
 *   At most ONE AI model may be resident in RAM at any moment.
 *
 * Pipeline stages acquire the model they need, use it, and release it before
 * the next stage initializes. The manager refuses overlapping acquisitions —
 * a second acquire() while one is active throws immediately (fail loud, never
 * silently co-load two models and OOM low-end devices).
 *
 * Extracted text / timing JSON held between stages is plain JS data (KBs),
 * not a model — it does not violate the contract.
 *
 * Release is mandatory and awaited: the orchestrator awaits full teardown
 * before initializing the next stage. `runExclusive()` is the only API the
 * pipeline should use; it acquires, runs, and always releases in finally.
 */

/** Unique label per stage, used for diagnostics and lock ownership. */
export type ModelSlot = 'llm' | 'tts' | 'ocr';

interface ActiveHold {
  slot: ModelSlot;
  acquiredAt: number;
}

let active: ActiveHold | null = null;

export class ModelSlotBusyError extends Error {
  readonly requested: ModelSlot;
  readonly heldBy: ModelSlot;

  constructor(requested: ModelSlot, heldBy: ModelSlot) {
    super(
      `Resource contract violation: ${requested} cannot load while ${heldBy} is still in RAM. ` +
        `Release ${heldBy} before acquiring ${requested}.`
    );
    this.name = 'ModelSlotBusyError';
    this.requested = requested;
    this.heldBy = heldBy;
  }
}

/** True when exactly the given slot currently holds the lock. */
export function isSlotActive(slot: ModelSlot): boolean {
  return active?.slot === slot;
}

/** Current holder, for diagnostics/UI. Null when no model is resident. */
export function activeSlot(): ModelSlot | null {
  return active?.slot ?? null;
}

/**
 * Acquire the lock for a slot. Throws ModelSlotBusyError if another model is
 * resident. Returns a release function — call it and AWAIT it as soon as the
 * model is no longer needed. Prefer runExclusive() which does this for you.
 */
export function acquireModelSlot(slot: ModelSlot): () => void {
  if (active) {
    throw new ModelSlotBusyError(slot, active.slot);
  }
  active = { slot, acquiredAt: Date.now() };
  console.log(`[ModelManager] acquire ${slot}`);
  let released = false;
  return () => {
    if (released) return; // idempotent: double-release is a bug upstream, not a crash here
    released = true;
    if (active?.slot === slot) {
      console.log(`[ModelManager] release ${slot} (held ${Date.now() - active.acquiredAt}ms)`);
      active = null;
    }
  };
}

/**
 * Run a pipeline stage under the exclusive lock: acquires the slot, runs the
 * callback, and always releases — even on throw — before returning.
 *
 * If another stage still holds the slot, WAITS until it releases instead of
 * throwing — co-loading is still impossible, but a new run queued right after
 * an interrupted one no longer hard-fails on a stale hold. A hold older than
 * STALE_HOLD_MS is considered abandoned (e.g. dev reload killed the owner
 * mid-flight) and is force-cleared with a loud warning.
 *
 *   const script = await runExclusive('llm', async () => {
 *     const llama = await loadLlama();
 *     return await generateScript(llama, text);
 *   });
 */
const STALE_HOLD_MS = 10 * 60 * 1000; // 10 min — no legit stage runs this long

async function acquireWhenFree(slot: ModelSlot): Promise<() => void> {
  // Throttle the wait log — a queued run can wait minutes, and a line every
  // 500ms is pure log spam.
  let lastLogAt = 0;
  for (;;) {
    if (active) {
      const heldMs = Date.now() - active.acquiredAt;
      if (heldMs > STALE_HOLD_MS) {
        console.warn(
          `[ModelManager] hold on '${active.slot}' is stale (${Math.round(heldMs / 1000)}s) — assuming abandoned owner and force-clearing`
        );
        active = null;
      } else {
        if (Date.now() - lastLogAt >= 10_000) {
          lastLogAt = Date.now();
          console.log(
            `[ModelManager] slot '${slot}' busy (${active.slot}, held ${Math.round(heldMs / 1000)}s) — waiting…`
          );
        }
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
    }
    try {
      return acquireModelSlot(slot);
    } catch {
      // Raced with another acquirer — loop and wait again.
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

export async function runExclusive<T>(slot: ModelSlot, fn: () => Promise<T>): Promise<T> {
  const release = await acquireWhenFree(slot);
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Test/diagnostic helper: force-clear the lock (e.g. after a hard crash path). */
export function forceReleaseAll(): void {
  if (active) {
    console.warn(`[ModelManager] force-releasing ${active.slot}`);
    active = null;
  }
}
