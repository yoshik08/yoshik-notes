import { requireAuth, unauthorized } from '@/lib/auth/require-auth';

/** An expected failure with the exact JSON body and status the client receives. */
export class HttpError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(typeof body.error === 'string' ? body.error : `HTTP ${status}`);
  }
}

type Handler<P> = (owner: string, req: Request, params: P) => Promise<Response>;

/**
 * Route handler for signed-in users only: 401 without a session, HttpError
 * mapped to its JSON response. The owner id always comes from the session.
 */
export function withOwner<P = Record<string, never>>(handler: Handler<P>) {
  return async (req: Request, ctx: { params: Promise<P> }): Promise<Response> => {
    let owner: string;
    try {
      owner = await requireAuth();
    } catch {
      return unauthorized();
    }
    try {
      return await handler(owner, req, await ctx.params);
    } catch (e) {
      if (e instanceof HttpError) return Response.json(e.body, { status: e.status });
      throw e;
    }
  };
}
