import { Server } from "socket.io";
import { Server as HttpServer } from "http";
import { RequestHandler } from "express";
import { verifyToken } from "./utils/jwt.js";

let io: Server;

export function initSocket(server: HttpServer, sessionMiddleware: RequestHandler) {
  io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_ORIGIN || process.env.CORS_ORIGIN || "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  // Share session with socket.io
  io.engine.use(sessionMiddleware);

  io.on("connection", (socket) => {
    const session = (socket.request as any).session;
    let userId = session?.userId;
    let userName = session?.userName;

    // Fallback to Bearer Token if no session
    if (!userId) {
      const token = socket.handshake.auth?.token;
      if (token) {
        const decoded = verifyToken(token);
        if (decoded) {
          userId = decoded.userId;
          userName = decoded.userName;
        }
      }
    }

    if (!userId) {
      console.log("Unauthorized socket connection attempt:", socket.id);
      socket.disconnect();
      return;
    }

    console.log("Client connected (Authenticated):", socket.id, "User:", userName);
    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
    });
  });

  return io;
}

export function getIo() {
  if (!io) {
    throw new Error("Socket.io not initialized");
  }
  return io;
}
