import { Response } from "express";

export class AppError extends Error {
  statusCode: number;
  errors?: any[];

  constructor(message: string, statusCode: number = 400, errors?: any[]) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const sendSuccess = (res: Response, data: any, message: string = "Success", statusCode: number = 200) => {
  return res.status(statusCode).json({
    status: "success",
    message,
    data,
  });
};

export const sendError = (res: Response, message: string = "Error", statusCode: number = 400, errors: any[] = []) => {
  return res.status(statusCode).json({
    status: "error",
    message,
    ...(errors.length > 0 && { errors }),
  });
};
