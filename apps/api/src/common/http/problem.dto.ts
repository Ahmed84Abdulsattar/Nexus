import { problemDetailsSchema } from '@nexus/shared';
import { createDto } from './dto.js';

/** The error body as an OpenAPI component (named after the class: `ProblemDetails`). */
export class ProblemDetails extends createDto(problemDetailsSchema) {}
