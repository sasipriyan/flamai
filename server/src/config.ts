import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const SERVER_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const envPaths = [SERVER_ENV];

for (const path of envPaths) {
  if (existsSync(path)) {
    dotenv.config({ path, override: false });
  }
}

export const config = {
  mongoUri: process.env.MONGODB_URI ?? process.env.MONGO_URI,
  mongoDbName: process.env.MONGODB_DB ?? "flamai",
};
