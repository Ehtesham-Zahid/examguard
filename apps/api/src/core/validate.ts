import type { Request } from 'express';
import { z } from 'zod';

export const parseBody = <T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> => schema.parse(req.body ?? {});
export const parseQuery = <T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> => schema.parse(req.query ?? {});
export const id = z.string().min(1).max(64);
export const param = (req: Request, name: string) => z.string().min(1).max(64).parse(req.params[name]);
