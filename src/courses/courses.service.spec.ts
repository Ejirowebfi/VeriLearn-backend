import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { CoursesService } from './courses.service';
import {
  Course,
  Lesson,
  Enrollment,
  CourseStatus,
} from './entities/course.entity';
import { SearchService } from '../search/search.service';
import { EmailService } from '../email/email.service';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/entities/user.entity';

const mockCourse = {
  id: 'course-1',
  title: 'Stellar Basics',
  description: 'Learn Stellar blockchain',
  status: CourseStatus.PUBLISHED,
  instructorId: 'user-1',
  tags: ['blockchain'],
  category: 'blockchain',
};

const mockEnrollment = {
  id: 'enrollment-1',
  userId: 'user-2',
  courseId: 'course-1',
  isCompleted: false,
  completedAt: null,
};

const mockCourseRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  increment: jest.fn(),
};

const mockLessonRepo = {
  create: jest.fn(),
  save: jest.fn(),
};

const mockEnrollmentRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
};

const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  store: { keys: jest.fn().mockResolvedValue([]) },
};

const mockSearchService = {
  indexDocument: jest.fn().mockResolvedValue(undefined),
  deleteDocument: jest.fn().mockResolvedValue(undefined),
};

describe('CoursesService', () => {
  let service: CoursesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoursesService,
        { provide: getRepositoryToken(Course), useValue: mockCourseRepo },
        { provide: getRepositoryToken(Lesson), useValue: mockLessonRepo },
        {
          provide: getRepositoryToken(Enrollment),
          useValue: mockEnrollmentRepo,
        },
        { provide: CACHE_MANAGER, useValue: mockCache },
        { provide: SearchService, useValue: mockSearchService },
        {
          provide: EmailService,
          useValue: {
            sendCourseCompletion: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findById: jest
              .fn()
              .mockResolvedValue({ email: 'u@test.com', firstName: 'U' }),
          },
        },
      ],
    }).compile();

    service = module.get<CoursesService>(CoursesService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('creates course and indexes in ES', async () => {
      mockCourseRepo.create.mockReturnValue(mockCourse);
      mockCourseRepo.save.mockResolvedValue(mockCourse);
      mockCache.store.keys.mockResolvedValue([]);

      const result = await service.create(
        { title: 'Stellar Basics', description: 'Learn Stellar blockchain' } as any,
        'user-1',
      );

      expect(result).toEqual(mockCourse);
      expect(mockCache.store.keys).toHaveBeenCalledWith('courses:all:*');
      expect(mockSearchService.indexDocument).toHaveBeenCalledWith('courses', 'course-1', expect.any(Object));
    });
  });

  describe('findAll', () => {
    it('returns cached value when cache hit', async () => {
      const cached = { data: [mockCourse], total: 1, page: 1, limit: 20 };
      mockCache.get.mockResolvedValue(cached);
      const result = await service.findAll();
      expect(result).toEqual(cached);
      expect(mockCourseRepo.findAndCount).not.toHaveBeenCalled();
    });

    it('queries DB and caches result on cache miss', async () => {
      mockCache.get.mockResolvedValue(null);
      mockCourseRepo.findAndCount.mockResolvedValue([[mockCourse], 1]);
      mockCache.set.mockResolvedValue(undefined);

      const result = await service.findAll();
      expect(result.data).toEqual([mockCourse]);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(mockCache.set).toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('returns cached course on hit', async () => {
      mockCache.get.mockResolvedValue(mockCourse);
      const result = await service.findById('course-1');
      expect(result).toEqual(mockCourse);
      expect(mockCourseRepo.findOne).not.toHaveBeenCalled();
    });

    it('fetches from DB and caches on miss', async () => {
      mockCache.get.mockResolvedValue(null);
      mockCourseRepo.findOne.mockResolvedValue(mockCourse);
      mockCache.set.mockResolvedValue(undefined);

      const result = await service.findById('course-1');
      expect(result).toEqual(mockCourse);
      expect(mockCache.set).toHaveBeenCalledWith('courses:course-1', mockCourse, 300);
    });

    it('throws NotFoundException when course not found', async () => {
      mockCache.get.mockResolvedValue(null);
      mockCourseRepo.findOne.mockResolvedValue(null);
      await expect(service.findById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('throws ForbiddenException when user is not owner', async () => {
      mockCache.get.mockResolvedValue(mockCourse);
      await expect(
        service.update('course-1', { title: 'New' }, 'other-user', UserRole.STUDENT),
      ).rejects.toThrow(ForbiddenException);
    });

    it('updates course as owner and invalidates cache', async () => {
      mockCache.get.mockResolvedValue(mockCourse);
      mockCourseRepo.save.mockResolvedValue({ ...mockCourse, title: 'Updated' });
      mockCache.del.mockResolvedValue(undefined);
      mockCache.store.keys.mockResolvedValue([]);

      const result = await service.update('course-1', { title: 'Updated' }, 'user-1', UserRole.INSTRUCTOR);
      expect(result.title).toBe('Updated');
      expect(mockCache.del).toHaveBeenCalledWith('courses:course-1');
    });

    it('allows admin to update any course', async () => {
      mockCache.get.mockResolvedValue(mockCourse);
      mockCourseRepo.save.mockResolvedValue({ ...mockCourse, title: 'Admin Updated' });
      mockCache.del.mockResolvedValue(undefined);
      mockCache.store.keys.mockResolvedValue([]);

      const result = await service.update('course-1', { title: 'Admin Updated' }, 'admin-id', UserRole.ADMIN);
      expect(result.title).toBe('Admin Updated');
    });
  });

  describe('remove', () => {
    it('removes course and deletes from ES', async () => {
      mockCache.get.mockResolvedValue(mockCourse);
      mockCourseRepo.remove.mockResolvedValue(undefined);
      mockCache.del.mockResolvedValue(undefined);

      await service.remove('course-1', 'user-1', UserRole.INSTRUCTOR);
      expect(mockCourseRepo.remove).toHaveBeenCalled();
      expect(mockSearchService.deleteDocument).toHaveBeenCalledWith('courses', 'course-1');
    });

    it('throws ForbiddenException when user does not own course', async () => {
      mockCache.get.mockResolvedValue(mockCourse);
      await expect(
        service.remove('course-1', 'other-user', UserRole.STUDENT),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('enroll', () => {
    it('enrolls user in a published course', async () => {
      mockCache.get.mockResolvedValue(mockCourse);
      mockEnrollmentRepo.findOne.mockResolvedValue(null);
      mockEnrollmentRepo.create.mockReturnValue(mockEnrollment);
      mockEnrollmentRepo.save.mockResolvedValue(mockEnrollment);
      mockCourseRepo.increment.mockResolvedValue(undefined);
      mockCache.del.mockResolvedValue(undefined);

      const result = await service.enroll('course-1', 'user-2');
      expect(result).toEqual(mockEnrollment);
    });

    it('throws ConflictException when already enrolled', async () => {
      mockCache.get.mockResolvedValue(mockCourse);
      mockEnrollmentRepo.findOne.mockResolvedValue(mockEnrollment);
      await expect(service.enroll('course-1', 'user-2')).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when course is not published', async () => {
      mockCache.get.mockResolvedValue({ ...mockCourse, status: CourseStatus.DRAFT });
      await expect(service.enroll('course-1', 'user-2')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('completeCourse', () => {
    it('marks enrollment as completed', async () => {
      const enrollment = { ...mockEnrollment };
      mockEnrollmentRepo.findOne.mockResolvedValue(enrollment);
      mockEnrollmentRepo.save.mockResolvedValue({ ...enrollment, isCompleted: true });

      const result = await service.completeCourse('course-1', 'user-2');
      expect(result.isCompleted).toBe(true);
      expect(result.completedAt).toBeDefined();
    });

    it('throws NotFoundException when not enrolled', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue(null);
      await expect(service.completeCourse('course-1', 'user-2')).rejects.toThrow(NotFoundException);
    });
  });
});
