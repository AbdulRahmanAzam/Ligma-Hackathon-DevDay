/**
 * Seed step. Demo accounts (Alice / Bob / Carol) have been retired in favor
 * of real signup. This module is kept as a no-op hook so index.ts can still
 * `await seed()` without changes; if we ever want to bootstrap an example
 * room with content, this is where it'd go.
 */
export async function seed(): Promise<void> {
  // intentionally empty
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
