import { Request } from 'express';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

export interface RequestWithAuthenticatedUser extends Request {
  authenticatedUser: AuthenticatedUser;
}
