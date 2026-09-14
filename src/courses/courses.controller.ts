import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { CoursesService } from './courses.service';
import {
  CreateCourseDto,
  UpdateCourseDto,
  CreateLessonDto,
} from './dto/course.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@ApiTags('courses')
@Controller('courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  // Static routes MUST come before param routes to avoid :id capturing 'my'
  @Get('my/enrollments')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get my enrollments' })
  myEnrollments(@Request() req) {
    return this.coursesService.getEnrollments(req.user.id);
  }

  @SkipThrottle()
  @Get()
  @ApiOperation({ summary: 'List published courses' })
  @ApiQuery({ name: 'all', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(@Query('all') all?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.coursesService.findAll(all !== 'true', page ? +page : 1, limit ? +limit : 20);
  }

  @SkipThrottle()
  @Get(':id')
  @ApiOperation({ summary: 'Get course details' })
  findOne(@Param('id') id: string) { return this.coursesService.findById(id); }

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a course' })
  create(@Body() dto: CreateCourseDto, @Request() req) {
    return this.coursesService.create(dto, req.user.id);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update a course' })
  update(@Param('id') id: string, @Body() dto: UpdateCourseDto, @Request() req) {
    return this.coursesService.update(id, dto, req.user.id, req.user.role);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Delete a course' })
  remove(@Param('id') id: string, @Request() req) {
    return this.coursesService.remove(id, req.user.id, req.user.role);
  }

  @Post(':id/lessons')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Add lesson to course' })
  addLesson(@Param('id') id: string, @Body() dto: CreateLessonDto, @Request() req) {
    return this.coursesService.addLesson(id, dto, req.user.id, req.user.role);
  }

  @Patch(':id/lessons/:lessonId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update a lesson' })
  updateLesson(@Param('id') id: string, @Param('lessonId') lessonId: string, @Body() dto: CreateLessonDto, @Request() req) {
    return this.coursesService.updateLesson(id, lessonId, dto, req.user.id, req.user.role);
  }

  @Delete(':id/lessons/:lessonId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Delete a lesson' })
  removeLesson(@Param('id') id: string, @Param('lessonId') lessonId: string, @Request() req) {
    return this.coursesService.removeLesson(id, lessonId, req.user.id, req.user.role);
  }

  @Post(':id/enroll')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Enroll in a course' })
  enroll(@Param('id') id: string, @Request() req) {
    return this.coursesService.enroll(id, req.user.id);
  }

  @Post(':id/complete')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Mark course as completed' })
  complete(@Param('id') id: string, @Request() req) {
    return this.coursesService.completeCourse(id, req.user.id);
  }
}
