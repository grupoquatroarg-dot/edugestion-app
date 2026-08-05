import jwt from "jsonwebtoken";
import { getSessionSecret } from "./securityConfig.js";

export interface TokenPayload {
  userId: number;
  role: string;
  userName: string;
  sessionVersion?: number;
  exp?: number;
}

export const generateToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, getSessionSecret(), { expiresIn: "24h" });
};

export const verifyToken = (token: string): TokenPayload | null => {
  try {
    return jwt.verify(token, getSessionSecret()) as TokenPayload;
  } catch {
    return null;
  }
};
