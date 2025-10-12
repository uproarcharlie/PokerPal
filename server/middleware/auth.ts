import { Request, Response, NextFunction } from "express";

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
        name: string;
      };
    }
  }
}

// Middleware to check if user is authenticated
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

// Middleware to check if user is an admin
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: "Admin access required" });
  }

  next();
}

// Middleware to check if user is authenticated (admin or full member)
export function requireFullMember(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (req.session.role !== 'admin' && req.session.role !== 'full_member') {
    return res.status(403).json({ error: "Full member access required" });
  }

  next();
}

// Optional auth - attach user info if logged in, but don't block if not
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session.userId) {
    // User is logged in, you could fetch and attach user data here if needed
  }
  next();
}
