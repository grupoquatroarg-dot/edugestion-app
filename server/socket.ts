import { Server } from "socket.io";
import { Server as HttpServer } from "http";
import { RequestHandler } from "express";
import { verifyToken } from "./utils/jwt.js";

type RealtimeEmitter = {
  emit: (event: string, ...args: any[]) => boolean;
};

const noopEmitter: RealtimeEmitter = {
  emit: () => false,
};

let io: Server | null = null;

function isRealtimeEnabled() {
  return process.env.ENABLE_SOCKET_IO === "true" || process.env.NODE_ENV !== "production";
}

export function initSocket(server: HttpServer, sessionMiddleware: RequestHandler) {
  if (!isRealtimeEnabled()) {
    console.log("Socket.IO disabled for this environment");
    io = null;
    return noopEmitter;
  }

  try {
    io = new Server(server, {
      cors: {
        origin: process.env.CLIENT_ORIGIN || process.env.CORS_ORIGIN || "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true,
      },
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
  } catch (error) {
    console.error("Socket.IO initialization failed. Continuing without realtime:", error);
    io = null;
    return noopEmitter;
  }
}

export function getIo(): RealtimeEmitter {
  return io ?? noopEmitter;
}
