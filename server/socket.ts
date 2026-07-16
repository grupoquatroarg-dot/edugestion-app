import { Server } from "socket.io";
import { Server as HttpServer } from "http";
import { RequestHandler } from "express";
import { validateStaffSession, validateStaffToken } from "./services/currentUserAuthService.js";

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

    io.engine.use(sessionMiddleware);

    io.on("connection", async (socket) => {
      const session = (socket.request as any).session;
      let authUser = session?.userId
        ? await validateStaffSession(session.userId, session.sessionVersion)
        : null;

      if (!authUser) {
        authUser = await validateStaffToken(socket.handshake.auth?.token);
      }

      if (!authUser) {
        console.log("Unauthorized socket connection attempt:", socket.id);
        socket.disconnect();
        return;
      }

      console.log("Client connected (Authenticated):", socket.id, "User:", authUser.userName);
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
