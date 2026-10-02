// Mutable service-worker runtime state. MV3 workers are evicted when idle, so nothing here may be
// treated as durable — it only spans one awake period, exactly like the flags it replaces in the
// vanilla file (skill.md §5.4, "stateless across restarts").
export const runtime = {
  /** @type {ReturnType<typeof setTimeout>|null} Pending debounced auto-save. */
  autoSaveTimer: null,
  /** True while startup is restoring tabs, to suppress intermediate auto-saves. */
  isRestoring: false,
  /** Epoch ms of this worker's startup, or 0 when it did not just start. */
  startupTime: 0,
};
