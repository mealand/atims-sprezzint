export interface AuthEntity {
  id: string;
  nexus_id: string;
  name: string;
  role: import('@atims/shared').Role;
  status: import('@atims/shared').EntityStatus;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
    requireRole: (...roles: string[]) => (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    entity?: AuthEntity;
  }
}
export {};
