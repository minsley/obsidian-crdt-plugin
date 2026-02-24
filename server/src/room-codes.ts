/**
 * Ephemeral room code registry.
 * Generates human-readable codes (word-word-NN) that map to full room names.
 * Codes exist only while the server is running — no persistence needed.
 */

const ADJECTIVES = [
  "amber", "bold", "calm", "dark", "easy", "fast", "gold", "hazy",
  "iron", "just", "keen", "lime", "mild", "neat", "open", "pink",
  "quick", "rare", "sage", "teal", "unit", "vast", "warm", "zinc",
];

const NOUNS = [
  "arch", "beam", "cave", "dock", "edge", "fern", "gate", "hive",
  "isle", "jade", "knot", "lake", "mesa", "node", "onyx", "peak",
  "quay", "reef", "star", "tide", "vale", "wave", "yard", "zone",
];

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateCode(): string {
  const num = Math.floor(Math.random() * 100);
  return `${randomElement(ADJECTIVES)}-${randomElement(NOUNS)}-${num.toString().padStart(2, "0")}`;
}

export class RoomCodeRegistry {
  // code -> roomName
  private codeToRoom = new Map<string, string>();
  // roomName -> code (reverse lookup for reuse)
  private roomToCode = new Map<string, string>();

  /**
   * Create or retrieve a code for a room name.
   * Returns the same code if the room already has one.
   */
  create(roomName: string): string {
    const existing = this.roomToCode.get(roomName);
    if (existing) return existing;

    let code: string;
    do {
      code = generateCode();
    } while (this.codeToRoom.has(code));

    this.codeToRoom.set(code, roomName);
    this.roomToCode.set(roomName, code);
    return code;
  }

  /** Resolve a code to a room name, or undefined if not found. */
  lookup(code: string): string | undefined {
    return this.codeToRoom.get(code);
  }

  /** Remove a room's code (e.g. when room has no more clients). */
  remove(roomName: string): void {
    const code = this.roomToCode.get(roomName);
    if (code) {
      this.codeToRoom.delete(code);
      this.roomToCode.delete(roomName);
    }
  }

  /** List all active codes with their room names. */
  entries(): Array<{ code: string; roomName: string }> {
    return Array.from(this.codeToRoom.entries()).map(([code, roomName]) => ({
      code,
      roomName,
    }));
  }
}
