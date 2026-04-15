import { Request, Response, NextFunction } from 'express';
import { UserRepository } from '../repositories/userRepository.js';
import { sendError } from '../utils/response.js';
import { verifyToken } from '../utils/jwt.js';

/**
 * Extracts user info from session or Bearer token.
 */
const getAuthUser = (req: Request) => {
  // 1. Try Session
  const sessionUser = {
    userId: (req.session as any).userId,
    role: (req.session as any).role,
    userName: (req.session as any).userName
  };

  if (sessionUser.userId) {
    return sessionUser;
  }

  // 2. Try Bearer Token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    if (decoded) {
      return decoded;
    }
  }

  return null;
};

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const user = getAuthUser(req);
  if (!user) {
    return sendError(res, "Unauthorized: Login required", 401);
  }
  // Attach user to request for downstream use if needed
  (req as any).user = user;
  next();
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  const user = getAuthUser(req);
  if (!user || user.role !== 'administrador') {
    return sendError(res, "Forbidden: Admin access required", 403);
  }
  (req as any).user = user;
  next();
};

export const requirePermission = (module: string, action: 'view' | 'create' | 'edit' | 'delete') => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = getAuthUser(req);
    
    if (!user) {
      console.warn(`[Auth] Unauthorized: No auth found for module ${module}`);
      return sendError(res, "Unauthorized: Login required", 401);
    }

    const { userId, role } = user;
    (req as any).user = user;

    console.log(`[Auth] Module: ${module}, Action: ${action}, UserId: ${userId}, Role: ${role}`);

    if (role === 'administrador') {
      return next();
    }

    const permissions = UserRepository.getPermissions(userId);
    const perm = permissions[module];

    if (!perm) {
      return sendError(res, `Forbidden: No permissions for module ${module}`, 403);
    }

    const hasAccess = (() => {
      switch (action) {
        case 'view': return !!perm.can_view;
        case 'create': return !!perm.can_create;
        case 'edit': return !!perm.can_edit;
        case 'delete': return !!perm.can_delete;
        default: return false;
      }
    })();

    if (!hasAccess) {
      return sendError(res, `Forbidden: No ${action} permission for module ${module}`, 403);
    }

    next();
  };
};
