import { createHash } from "node:crypto";

export const hashAuthToken = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");
