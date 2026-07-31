import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Security Middleware
  app.use(helmet());
  app.use(cookieParser());

  // CORS Configuration
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
  });

  // Global Prefix
  app.setGlobalPrefix('api');

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global Exception Filter & Response Interceptor
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new ResponseTransformInterceptor());

  // Swagger / OpenAPI Specification
  const config = new DocumentBuilder()
    .setTitle('InkFlow Enterprise REST API')
    .setDescription('Production-ready REST API powering InkFlow publishing platform (Medium/Hashnode alternative).')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Auth', 'Authentication & Authorization')
    .addTag('Users', 'User Management & Profiles')
    .addTag('Posts', 'Article Publishing & Management')
    .addTag('Comments', 'Threaded Responses & Moderation')
    .addTag('Categories', 'Topics & Taxonomy')
    .addTag('Tags', 'Article Tags & Search')
    .addTag('Library', 'Reading Lists, Bookmarks & History')
    .addTag('Reports', 'Admin Response Moderation Queue')
    .addTag('Analytics', 'Platform Views & Reader Metrics')
    .addTag('Health', 'System & Database Health Checks')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 4000;
  await app.listen(port);
  logger.log(`🍃 Database connected successfully (MongoDB)`);
  logger.log(`🚀 InkFlow Enterprise API running on http://localhost:${port}/api`);
  logger.log(`📚 Swagger Documentation live at http://localhost:${port}/api/docs`);
}

bootstrap();
