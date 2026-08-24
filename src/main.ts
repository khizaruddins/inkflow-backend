import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, INestApplication } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor';

let app: INestApplication | null = null;

/**
 * Bootstrap NestJS application.
 * Exported for Vercel Serverless execution.
 */
export async function bootstrap(): Promise<INestApplication> {
  if (app) {
    return app;
  }

  const logger = new Logger('Bootstrap');
  const nestApp = await NestFactory.create(AppModule);

  // Security Middleware
  nestApp.use(
    helmet({
      crossOriginResourcePolicy: {
        policy: 'cross-origin',
      },
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: false,
    }),
  );
  nestApp.use(cookieParser());

  // CORS Configuration
  const rawOrigins = process.env.ALLOWED_ORIGINS;
  const explicitOrigins = rawOrigins
    ? rawOrigins.split(',').map((o) => o.trim()).filter(Boolean)
    : ['http://localhost:3000', 'http://localhost:4000'];

  nestApp.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) {
        return callback(null, true);
      }
      // Allow wildcard, configured origins, localhost, or any *.vercel.app domain
      if (
        rawOrigins === '*' ||
        explicitOrigins.includes(origin) ||
        origin.endsWith('.vercel.app') ||
        origin.includes('localhost')
      ) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} not allowed by CORS`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'Cookie',
      'sec-ch-ua',
      'sec-ch-ua-mobile',
      'sec-ch-ua-platform',
      'DNT',
      'Referer',
      'User-Agent',
    ],
    exposedHeaders: ['Set-Cookie'],
  });

  // Global Prefix
  nestApp.setGlobalPrefix('api');

  // Global Validation Pipe
  nestApp.useGlobalPipes(
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
  nestApp.useGlobalFilters(new GlobalExceptionFilter());
  nestApp.useGlobalInterceptors(new ResponseTransformInterceptor());

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

  const document = SwaggerModule.createDocument(nestApp, config);
  SwaggerModule.setup('api/docs', nestApp, document, {
    customSiteTitle: 'InkFlow API Documentation',
    customCssUrl:
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui.min.css',
    customJs: [
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui-bundle.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui-standalone-preset.min.js',
    ],
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      docExpansion: 'none',
    },
  });

  await nestApp.init();
  app = nestApp;

  logger.log('🚀 InkFlow NestJS application initialized');

  return app;
}

// Local development server only (Vercel does not execute app.listen)
if (!process.env.VERCEL) {
  void bootstrap()
    .then(async (nestApp) => {
      const port = process.env.PORT || 4000;
      await nestApp.listen(port);
      const logger = new Logger('Bootstrap');
      logger.log(`🚀 InkFlow Enterprise API running on http://localhost:${port}/api`);
      logger.log(`📚 Swagger Documentation live at http://localhost:${port}/api/docs`);
    })
    .catch((err: unknown) => {
      console.error('❌ Failed to start application locally:', err);
      process.exit(1);
    });
}
