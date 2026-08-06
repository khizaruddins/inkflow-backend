import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async findAll(search?: string) {
    const where: any = {};
    if (search && search.trim() !== '') {
      where.name = { contains: search.trim(), mode: 'insensitive' };
    }

    const categories = await this.prisma.category.findMany({
      where,
      include: {
        _count: {
          select: { posts: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description || '',
      color: c.color || 'from-emerald-500 to-teal-600',
      postCount: c._count?.posts || 0,
    }));
  }

  async findOrCreate(dto: CreateCategoryDto) {
    const name = dto.name.trim();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    let category = await this.prisma.category.findFirst({
      where: {
        OR: [{ slug }, { name: { equals: name, mode: 'insensitive' } }],
      },
    });

    if (!category) {
      category = await this.prisma.category.create({
        data: {
          name,
          slug,
          description: `${name} topics and stories`,
          color: 'from-emerald-500 to-teal-600',
        },
      });
    }

    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description || '',
      color: category.color || 'from-emerald-500 to-teal-600',
      postCount: 0,
    };
  }
}
