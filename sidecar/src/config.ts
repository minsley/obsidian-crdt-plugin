export interface SidecarConfig {
  serverUrl: string;
  serverHttpUrl: string;
}

export function loadConfig(): SidecarConfig {
  const wsUrl = process.env.WS_SERVER_URL || "ws://localhost:1234";
  // Derive HTTP URL from WS URL for room listing
  const httpUrl = wsUrl.replace(/^ws/, "http");

  return {
    serverUrl: wsUrl,
    serverHttpUrl: httpUrl,
  };
}
