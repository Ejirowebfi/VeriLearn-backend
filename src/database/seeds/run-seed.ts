import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

dotenv.config();

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'verilearn',
  entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
  synchronize: false,
});

async function seed() {
  await AppDataSource.initialize();
  console.log('Seeding database...');

  const userRepo = AppDataSource.getRepository('users');

  const adminExists = await userRepo.findOne({
    where: { email: 'admin@verilearn.io' },
  });
  if (!adminExists) {
    await userRepo.save({
      email: 'admin@verilearn.io',
      firstName: 'Admin',
      lastName: 'VeriLearn',
      password: await bcrypt.hash('Admin@123456', 12),
      role: 'admin',
      isEmailVerified: true,
      isActive: true,
    });
    console.log('✓ Admin user created: admin@verilearn.io / Admin@123456');
  }

  const instructorExists = await userRepo.findOne({
    where: { email: 'instructor@verilearn.io' },
  });
  if (!instructorExists) {
    await userRepo.save({
      email: 'instructor@verilearn.io',
      firstName: 'Demo',
      lastName: 'Instructor',
      password: await bcrypt.hash('Instructor@123456', 12),
      role: 'instructor',
      isEmailVerified: true,
      isActive: true,
    });
    console.log(
      '✓ Instructor user created: instructor@verilearn.io / Instructor@123456',
    );
  }

  const courseRepo = AppDataSource.getRepository('courses');
  const instructor = await userRepo.findOne({
    where: { email: 'instructor@verilearn.io' },
  });

  const courseExists = await courseRepo.findOne({
    where: { title: 'Introduction to Stellar Blockchain' },
  });
  if (!courseExists && instructor) {
    await courseRepo.save({
      title: 'Introduction to Stellar Blockchain',
      description:
        'Learn the fundamentals of the Stellar network, Lumens (XLM), and Soroban smart contracts.',
      status: 'published',
      level: 'beginner',
      price: 0,
      category: 'Blockchain',
      tags: ['stellar', 'blockchain', 'soroban', 'web3'],
      instructorId: instructor.id,
    });
    console.log('✓ Sample course created');
  }

  await AppDataSource.destroy();
  console.log('Seeding complete!');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
