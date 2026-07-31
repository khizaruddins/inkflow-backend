import { PrismaClient, Role, PostStatus, PostVisibility } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding MongoDB database for InkFlow...');

  const passwordHash = await bcrypt.hash('Password123!', 10);

  // 1. Seed Authors & Users
  const syed = await prisma.user.upsert({
    where: { email: 'syed@inkflow.dev' },
    update: {},
    create: {
      email: 'syed@inkflow.dev',
      name: 'Syed Khizaruddin',
      username: 'syedkhizar',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80',
      bio: 'Senior Software Engineer & Tech Writer. Architecting high-throughput distributed systems & UI/UX.',
      role: Role.ADMIN,
      masterPrivatePassword: passwordHash,
      followingUserIds: [],
    },
  });

  const marcus = await prisma.user.upsert({
    where: { email: 'marcus@inkflow.dev' },
    update: {},
    create: {
      email: 'marcus@inkflow.dev',
      name: 'Marcus Chen',
      username: 'marcus_c',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80',
      bio: 'Staff Frontend Engineer at Frontend Weekly.',
      role: Role.WRITER,
      masterPrivatePassword: passwordHash,
      followingUserIds: [],
    },
  });

  const anna = await prisma.user.upsert({
    where: { email: 'anna@inkflow.dev' },
    update: {},
    create: {
      email: 'anna@inkflow.dev',
      name: 'Anna Saraiva',
      username: 'annasaraiva',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80',
      bio: 'Principal Systems Architect & Distributed Data Specialist.',
      role: Role.WRITER,
      masterPrivatePassword: passwordHash,
      followingUserIds: [],
    },
  });

  const sophia = await prisma.user.upsert({
    where: { email: 'sophia@inkflow.dev' },
    update: {},
    create: {
      email: 'sophia@inkflow.dev',
      name: 'Sophia Williams',
      username: 'sophiaw',
      avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=300&q=80',
      bio: 'Lead System Architect in Cloud Scale & Distributed Systems.',
      role: Role.WRITER,
      masterPrivatePassword: passwordHash,
      followingUserIds: [],
    },
  });

  const darius = await prisma.user.upsert({
    where: { email: 'darius@inkflow.dev' },
    update: {},
    create: {
      email: 'darius@inkflow.dev',
      name: 'Darius Foroux',
      username: 'dariusforoux',
      avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80',
      bio: 'Author & investor | Systems & Web Architecture Specialist.',
      role: Role.WRITER,
      masterPrivatePassword: passwordHash,
      followingUserIds: [],
    },
  });

  const alexandre = await prisma.user.upsert({
    where: { email: 'alexandre@inkflow.dev' },
    update: {},
    create: {
      email: 'alexandre@inkflow.dev',
      name: 'Alexandre Dubois',
      username: 'alexdubois',
      avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=300&q=80',
      bio: 'Design Systems Lead | Fluid motion & micro-interactions.',
      role: Role.WRITER,
      masterPrivatePassword: passwordHash,
      followingUserIds: [],
    },
  });

  // 2. Seed Categories
  const engineeringCategory = await prisma.category.upsert({
    where: { slug: 'engineering' },
    update: {},
    create: {
      name: 'Engineering',
      slug: 'engineering',
      description: 'System design, React, Next.js, and architecture.',
      color: 'from-blue-500 to-indigo-600',
    },
  });

  const systemDesignCategory = await prisma.category.upsert({
    where: { slug: 'system-design' },
    update: {},
    create: {
      name: 'System Design',
      slug: 'system-design',
      description: 'High throughput backend architecture.',
      color: 'from-emerald-500 to-teal-600',
    },
  });

  // 3. Seed Posts
  const post1 = await prisma.post.upsert({
    where: { slug: 'building-next-generation-react-19-frontend-architectures' },
    update: {},
    create: {
      title: 'Building Next-Generation React 19 Frontend Architectures',
      subtitle: 'A deep dive into Server Components, fine-grained reactivity, and TipTap rich-text integration.',
      slug: 'building-next-generation-react-19-frontend-architectures',
      excerpt: 'Explore how React 19 Server Components combined with Next.js App Router revolutionize enterprise content publishing platforms.',
      content: `<h2>The Evolution of Modern Web Applications</h2><p>Over the past decade, frontend development has transitioned from basic server-rendered HTML templates to rich single-page applications...</p>`,
      coverImage: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80',
      authorId: syed.id,
      categoryId: engineeringCategory.id,
      status: PostStatus.PUBLISHED,
      visibility: PostVisibility.PUBLIC,
      readingTimeMinutes: 6,
      wordCount: 1200,
      clapsCount: 842,
      viewsCount: 14200,
      isFeatured: true,
      isPinned: true,
      publishedAt: new Date('2026-07-25T10:00:00Z'),
    },
  });

  const post2 = await prisma.post.upsert({
    where: { slug: 'nightmare-at-the-museum-building-resilient-real-time-state' },
    update: {},
    create: {
      title: 'Night(mare) at the museum: Building resilient real-time state',
      subtitle: 'Lessons learned from handling high frequency event streams in distributed web apps.',
      slug: 'nightmare-at-the-museum-building-resilient-real-time-state',
      excerpt: 'How we scaled WebSockets and optimistic UI mutations for zero-latency user experiences.',
      content: `<p>Real-time synchronization introduces unique edge cases in browser state management...</p>`,
      coverImage: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1200&q=80',
      authorId: anna.id,
      categoryId: systemDesignCategory.id,
      status: PostStatus.PUBLISHED,
      visibility: PostVisibility.PUBLIC,
      readingTimeMinutes: 4,
      wordCount: 890,
      clapsCount: 620,
      viewsCount: 9800,
      isFeatured: true,
      publishedAt: new Date('2026-07-26T14:30:00Z'),
    },
  });

  const post3 = await prisma.post.upsert({
    where: { slug: 'why-react-19-server-components-change-api-design' },
    update: {},
    create: {
      title: 'Why React 19 Server Components change API design',
      subtitle: 'Rethinking GraphQL vs REST endpoints in modern full-stack TypeScript applications.',
      slug: 'why-react-19-server-components-change-api-design',
      excerpt: 'Server Actions and Server Components allow frontend architectures to simplify client fetch waterfalls.',
      content: `<p>Server Components blur the boundary between client logic and server data fetching...</p>`,
      coverImage: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=1200&q=80',
      authorId: marcus.id,
      categoryId: engineeringCategory.id,
      status: PostStatus.PUBLISHED,
      visibility: PostVisibility.PUBLIC,
      readingTimeMinutes: 5,
      wordCount: 950,
      clapsCount: 412,
      viewsCount: 7300,
      isFeatured: true,
      publishedAt: new Date('2026-07-24T09:15:00Z'),
    },
  });

  const post4 = await prisma.post.upsert({
    where: { slug: 'what-senior-architects-look-for-in-system-design-interviews' },
    update: {},
    create: {
      title: 'What Senior Architects look for in system design interviews',
      subtitle: 'Trade-offs, scalability bottlenecks, caching strategies, and data consistency models.',
      slug: 'what-senior-architects-look-for-in-system-design-interviews',
      excerpt: 'A comprehensive checklist for designing resilient cloud native architectures under pressure.',
      content: `<p>System design is less about memorizing frameworks and more about evaluating fundamental trade-offs...</p>`,
      coverImage: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80',
      authorId: sophia.id,
      categoryId: systemDesignCategory.id,
      status: PostStatus.PUBLISHED,
      visibility: PostVisibility.PUBLIC,
      readingTimeMinutes: 7,
      wordCount: 1400,
      clapsCount: 980,
      viewsCount: 18500,
      isFeatured: true,
      publishedAt: new Date('2026-07-20T16:00:00Z'),
    },
  });

  // 4. Seed Comments
  await prisma.comment.create({
    data: {
      postId: post1.id,
      authorId: marcus.id,
      content: 'Sensational article! The comparison of React 19 server components with client-side state handling really resonated with our team.',
      clapsCount: 14,
    },
  });

  console.log('✅ MongoDB database seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
