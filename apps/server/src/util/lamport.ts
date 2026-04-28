/**
 * Per-room Lamport clock. The writer holds the authoritative server-side max
 * and stamps every accepted event with max(received, local) + 1.
 */
export class RoomLamport {
  private value = 0;

  constructor(initial = 0) {
    this.value = initial;
  }

  observe(received: number): number {
    this.value = Math.max(this.value, received);
    return this.value;
  }

  tick(received: number): number {
    this.value = Math.max(this.value, received) + 1;
    return this.value;
  }

  current(): number {
    return this.value;
  }
}
