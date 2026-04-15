import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { sendError, AppError } from "../utils/response.js";

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error(`[Error] ${req.method} ${req.url}:`, err);

  // Handle Zod Validation Errors
  if (err instanceof ZodError) {
    const errors = err.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return sendError(res, "Validation failed", 400, errors);
  }

  // Handle Custom App Errors
  if (err instanceof AppError) {
    return sendError(res, err.message, err.statusCode, err.errors || []);
  }

  // Handle SQLite Constraint Errors
  if (err.code === 'SQLITE_CONSTRAINT') {
    return sendError(res, "Database constraint violation", 400);
  }

  // Default Error
  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === "production" 
    ? "An unexpected error occurred" 
    : err.message || "Internal Server Error";

  return sendError(res, message, statusCode);
};
