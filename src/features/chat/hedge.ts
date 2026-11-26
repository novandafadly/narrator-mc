// Permintaan "hedged": jalankan kandidat pertama; jika gagal, atau belum menjawab
// setelah delayMs, jalankan kandidat berikutnya. Yang pertama berhasil menang,
// sisanya dibatalkan. Dipakai agar Nara tetap menjawab saat satu LLM lambat atau 503.

export type Starter<T> = (signal: AbortSignal) => Promise<T>;

export interface HedgeResult<T> {
  value: T;
  index: number;
}

export function hedgedStart<T>(
  starters: Starter<T>[],
  delayMs: number,
  onLoser?: (value: T) => void,
): Promise<HedgeResult<T>> {
  return new Promise((resolve, reject) => {
    if (starters.length === 0) {
      reject(new Error("hedgedStart: no starters"));
      return;
    }

    const controllers = starters.map(() => new AbortController());
    const errors: unknown[] = [];
    let settled = false;
    let started = 0;
    let failed = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const startNext = () => {
      if (settled || started >= starters.length) return;
      clearTimeout(timer);
      const i = started++;

      starters[i](controllers[i].signal).then(
        (value) => {
          if (settled) {
            onLoser?.(value);
            return;
          }
          settled = true;
          clearTimeout(timer);
          controllers.forEach((c, j) => {
            if (j !== i) c.abort();
          });
          resolve({ value, index: i });
        },
        (err) => {
          errors[i] = err;
          failed++;
          if (settled) return;
          if (failed >= starters.length) {
            settled = true;
            clearTimeout(timer);
            const msgs = errors
              .filter(Boolean)
              .map((e) => (e instanceof Error ? e.message : String(e)));
            reject(new Error(msgs.join(" | ")));
          } else if (started - failed === 0) {
            // tidak ada yang sedang berjalan: mulai kandidat berikutnya sekarang
            startNext();
          }
        },
      );

      if (started < starters.length) {
        timer = setTimeout(startNext, delayMs);
      }
    };

    startNext();
  });
}
