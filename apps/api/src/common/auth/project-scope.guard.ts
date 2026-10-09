import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { canAccessProject } from './access-context.js';
import type { AuthRequest } from './request.js';

/**
 * For routes with a `:projectId` parameter: 404 when the project is not in the user's scope.
 * It is 404, not 403, so the response does not reveal that the project exists (docs/08 step 5).
 * Use as `@UseGuards(ProjectScopeGuard)`; it runs after the global auth guards.
 */
@Injectable()
export class ProjectScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const projectId = request.params?.['projectId'];
    const access = request.auth?.access;
    if (!projectId || !access || !canAccessProject(access, projectId.toLowerCase())) {
      throw new NotFoundException('Project not found.');
    }
    return true;
  }
}
