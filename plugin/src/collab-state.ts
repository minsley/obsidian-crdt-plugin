import type { WebRTCSession } from "./webrtc-session";

export type CollabState = "offline" | "connecting" | "live" | "disconnecting";

export interface FileCollabInfo {
  uuid: string;
  state: CollabState;
  peerCount: number;
  roomCode?: string;
  session?: WebRTCSession;
  // Unlink undo cache — cleared on plugin unload
  unlinkCache?: { yjsData: Uint8Array };
}
