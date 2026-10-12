import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { canAccessProject } from './access-context.js';
import type { AuthRequest } from './request.js';

const projectIdSchema = z.uuid();

/**
 * Third global guard. For every route with a `:projectId` parameter: 404 when the id is not a
 * UUID or the project is not in the user's scope. It is 404, not 403, so the response does not
 * reveal that the project exists (docs/08 step 5). Routes without the parameter are untouched,
 * so nothing has to opt in.
 */
@Injectable()
export class ProjectScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const projectId = request.params?.['projectId'];
    if (projectId === undefined) return true;

    const access = request.auth?.access;
    if (
      !projectIdSchema.safeParse(projectId).success ||
      !access ||
      !canAccessProject(access, projectId)
    ) {
      throw new NotFoundException('Project not found.');
    }
    return true;
  }
}
