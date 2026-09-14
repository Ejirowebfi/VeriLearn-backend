import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import {
  Course,
  Lesson,
  Enrollment,
  CourseStatus,
} from './entities/course.entity';
import {
  CreateCourseDto,
  UpdateCourseDto,
  CreateLessonDto,
} from './dto/course.dto';
import { UserRole } from '../users/entities/user.entity';
import { SearchService } from '../search/search.service';
import { EmailService } from '../email/email.service';
import { UsersService } from '../users/users.service';

const CACHE_TTL = 300;
const ALL_COURSES_KEY = 'courses:all';
const courseKey = (id: string) => `courses:${id}`;

@Injectable()
export class CoursesService {
  constructor(
    @InjectRepository(Course) private readonly courseRepo: Repository<Course>,
    @InjectRepository(Lesson) private readonly lessonRepo: Repository<Lesson>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly searchService: SearchService,
    private readonly emailService: EmailService,
    private readonly usersService: UsersService,
  ) {}

  private async invalidateCourseListCache(): Promise<void> {
    const keys = await this.cache.store.keys(`${ALL_COURSES_KEY}:*`);
    await Promise.all(keys.map((k) => this.cache.del(k)));
  }

  async create(dto: CreateCourseDto, instructorId: string): Promise<Course> {
    const course = this.courseRepo.create({ ...dto, instructorId });
    const saved = await this.courseRepo.save(course);
    await this.invalidateCourseListCache();
    this.searchService
      .indexDocument('courses', saved.id, {
        title: saved.title,
        description: saved.description,
        category: saved.category,
        tags: saved.tags,
        status: saved.status,
      })
      .catch(() => null);
    return saved;
  }

  async findAll(
    published = true,
    page = 1,
    limit = 20,
  ): Promise<{ data: Course[]; total: number; page: number; limit: number }> {
    const cacheKey = `${ALL_COURSES_KEY}:${published}:${page}:${limit}`;
    const cached = await this.cache.get<{
      data: Course[];
      total: number;
      page: number;
      limit: number;
    }>(cacheKey);
    if (cached) return cached;
    const where = published ? { status: CourseStatus.PUBLISHED } : {};
    const [data, total] = await this.courseRepo.findAndCount({
      where,
      relations: ['instructor'],
      skip: (page - 1) * limit,
      take: limit,
    });
    const result = { data, total, page, limit };
    await this.cache.set(cacheKey, result, CACHE_TTL);
    return result;
  }

  async findById(id: string): Promise<Course> {
    const cached = await this.cache.get<Course>(courseKey(id));
    if (cached) return cached;
    const course = await this.courseRepo.findOne({
      where: { id },
      relations: ['instructor', 'lessons'],
    });
    if (!course) throw new NotFoundException('Course not found');
    await this.cache.set(courseKey(id), course, CACHE_TTL);
    return course;
  }

  async update(
    id: string,
    dto: UpdateCourseDto,
    userId: string,
    role: UserRole,
  ): Promise<Course> {
    const course = await this.findById(id);
    if (course.instructorId !== userId && role !== UserRole.ADMIN)
      throw new ForbiddenException();
    Object.assign(course, dto);
    const saved = await this.courseRepo.save(course);
    await Promise.all([
      this.cache.del(courseKey(id)),
      this.invalidateCourseListCache(),
    ]);
    this.searchService
      .indexDocument('courses', id, {
        title: saved.title,
        description: saved.description,
        category: saved.category,
        tags: saved.tags,
        status: saved.status,
      })
      .catch(() => null);
    return saved;
  }

  async remove(id: string, userId: string, role: UserRole): Promise<void> {
    const course = await this.findById(id);
    if (course.instructorId !== userId && role !== UserRole.ADMIN)
      throw new ForbiddenException();
    await this.courseRepo.remove(course);
    await Promise.all([
      this.cache.del(courseKey(id)),
      this.invalidateCourseListCache(),
    ]);
    this.searchService.deleteDocument('courses', id).catch(() => null);
  }

  async addLesson(
    courseId: string,
    dto: CreateLessonDto,
    userId: string,
    role: UserRole,
  ): Promise<Lesson> {
    const course = await this.findById(courseId);
    if (course.instructorId !== userId && role !== UserRole.ADMIN)
      throw new ForbiddenException();
    const lesson = this.lessonRepo.create({ ...dto, courseId });
    const saved = await this.lessonRepo.save(lesson);
    await this.cache.del(courseKey(courseId));
    return saved;
  }

  async updateLesson(
    courseId: string,
    lessonId: string,
    dto: Partial<CreateLessonDto>,
    userId: string,
    role: UserRole,
  ): Promise<Lesson> {
    const course = await this.findById(courseId);
    if (course.instructorId !== userId && role !== UserRole.ADMIN)
      throw new ForbiddenException();
    const lesson = await this.lessonRepo.findOne({
      where: { id: lessonId, courseId },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    Object.assign(lesson, dto);
    const saved = await this.lessonRepo.save(lesson);
    await this.cache.del(courseKey(courseId));
    return saved;
  }

  async removeLesson(
    courseId: string,
    lessonId: string,
    userId: string,
    role: UserRole,
  ): Promise<void> {
    const course = await this.findById(courseId);
    if (course.instructorId !== userId && role !== UserRole.ADMIN)
      throw new ForbiddenException();
    const lesson = await this.lessonRepo.findOne({
      where: { id: lessonId, courseId },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    await this.lessonRepo.remove(lesson);
    await this.cache.del(courseKey(courseId));
  }

  async enroll(courseId: string, userId: string): Promise<Enrollment> {
    const course = await this.findById(courseId);
    if (course.status !== CourseStatus.PUBLISHED) throw new ForbiddenException('Course not available');
    const existing = await this.enrollmentRepo.findOne({ where: { courseId, userId } });
    if (existing) throw new ConflictException('Already enrolled');
    const enrollment = this.enrollmentRepo.create({ courseId, userId });
    await this.courseRepo.increment({ id: courseId }, 'enrollmentCount', 1);
    await this.cache.del(courseKey(courseId));
    return this.enrollmentRepo.save(enrollment);
  }

  async getEnrollments(userId: string): Promise<Enrollment[]> {
    return this.enrollmentRepo.find({ where: { userId } });
  }

  async completeCourse(courseId: string, userId: string): Promise<Enrollment> {
    const enrollment = await this.enrollmentRepo.findOne({ where: { courseId, userId } });
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    enrollment.isCompleted = true;
    enrollment.completedAt = new Date();
    const saved = await this.enrollmentRepo.save(enrollment);

    // Fire-and-forget completion email
    Promise.all([this.usersService.findById(userId), this.findById(courseId)])
      .then(([user, course]) => {
        this.emailService.sendCourseCompletion(
          user.email, user.firstName, course.title, enrollment.credentialTxHash || '',
        ).catch(() => null);
      })
      .catch(() => null);

    return saved;
  }
}
