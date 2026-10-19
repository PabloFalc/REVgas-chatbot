import { applyDecorators, HttpCode, HttpStatus, UseInterceptors } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { createZodDto, type ZodDto } from 'nestjs-zod';
import { isZodDto } from 'nestjs-zod/dto';
import { ZodResponseInterceptor } from 'src/core/interceptors/zod-response.interceptor';
import type { ZodType } from 'zod';

export type ApiDocParams = {
  summary?: string;
  description?: string;
  body?: ZodType | ZodDto;
  query?: ZodType | ZodDto;
  param?: Record<string, ZodType | ZodDto | 'string' | 'number' | 'boolean'>;

  security?: {
    bearer?: boolean;
  };

  response?: Record<number, ZodType | ZodDto>;
  statusCode?: number;
};

export function ApiDoc(props: ApiDocParams): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const route = routeName(target, propertyKey);
    const decorators = buildApiDocDecorators(props, route);

    return applyDecorators(...decorators)(target, propertyKey, descriptor);
  };
}

function routeName(target: object, propertyKey: string | symbol): string {
  const controller = target.constructor.name.replace(/Controller$/, '');
  const method = String(propertyKey);

  return `${controller}${method.charAt(0).toUpperCase()}${method.slice(1)}`;
}

function namedDto(schema: ZodType | ZodDto, name: string): ZodDto {
  const zodSchema = (isZodDto(schema) ? (schema as ZodDto).schema : schema) as ZodType;

  const dto = createZodDto(zodSchema);

  Object.defineProperty(dto, 'name', {
    value: `${name.charAt(0).toUpperCase()}${name.slice(1)}`,
    writable: false,
  });

  return dto;
}

function buildApiDocDecorators(props: ApiDocParams, route: string): MethodDecorator[] {
  const decorators: MethodDecorator[] = [];

  const { summary, body, description, statusCode, query, response, security, param } = props;

  decorators.push(ApiOperation({ summary, description }));

  if (param) {
    Object.entries(param).forEach(([name, type]) => {
      if (typeof type === 'string') {
        decorators.push(ApiParam({ name, type }));
      } else {
        decorators.push(ApiParam({ name, type: namedDto(type, `${route}${name}Param`) }));
      }
    });
  }

  if (body) {
    decorators.push(ApiBody({ type: namedDto(body, `${route}Body`) }));
  }

  if (query) {
    decorators.push(ApiQuery({ type: namedDto(query, `${route}Query`) }));
  }

  if (security?.bearer) {
    decorators.push(ApiBearerAuth('bearer'));
  }

  if (response) {
    const schemas = Object.fromEntries(
      Object.entries(response).map(([status, schema]) => [
        Number(status),
        isZodDto(schema) ? ((schema as ZodDto).schema as ZodType) : (schema as ZodType),
      ]),
    ) as Record<number, ZodType>;

    decorators.push(UseInterceptors(new ZodResponseInterceptor(schemas)));

    Object.entries(response).forEach(([status, schema]) => {
      decorators.push(
        ApiResponse({ status: Number(status), type: namedDto(schema, `${route}${status}`) }),
      );
    });
  }

  decorators.push(HttpCode(statusCode ?? HttpStatus.OK));

  return decorators;
}
