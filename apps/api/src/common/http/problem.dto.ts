import { problemDetailsSchema } from '@nexus/shared';
import { createZodDto } from 'nestjs-zod';

/** The error body as an OpenAPI component (named after the class: `ProblemDetails`). */
export class ProblemDetails extends createZodDto(problemDetailsSchema) {}
