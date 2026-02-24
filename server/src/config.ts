export interface ServerConfig {
  port: number;
  host: string;
  leveldbPath: string;
}

export function loadConfig(): ServerConfig {
  return {
    port: parseInt(process.env.PORT || "1234", 10),
    host: process.env.HOST || "127.0.0.1",
    leveldbPath: process.env.LEVELDB_PATH || "./.leveldb",
  };
}
