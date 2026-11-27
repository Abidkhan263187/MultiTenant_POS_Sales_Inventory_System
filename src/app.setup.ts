import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.enableCors();
  app.use(
    helmet({
      // This API returns JSON, not web pages.
      contentSecurityPolicy: false,
      // Turn HSTS on only for a real HTTPS deployment. On local HTTP it would force the browser onto https://localhost.
      strictTransportSecurity: process.env.NODE_ENV === 'production',
    }),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) => {
        const messages = validationMessages(errors);
        return new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: messages.join(' ') || 'Check the request and try again.',
          errors: messages,
        });
      },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}

function validationMessages(errors: ValidationError[]): string[] {
  const messages: string[] = [];
  for (const error of errors) {
    if (error.constraints) {
      for (const text of Object.values(error.constraints)) {
        messages.push(
          text.includes('should not exist') ? `Remove "${error.property}" from the request.` : text,
        );
      }
    }
    if (error.children?.length) {
      messages.push(...validationMessages(error.children));
    }
  }
  return messages;
}
