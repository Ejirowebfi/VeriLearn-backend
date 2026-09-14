import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('credentials')
export class Credential {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  courseId: string;

  @Column()
  stellarPublicKey: string;

  @Column({ nullable: true })
  txHash: string;

  @Column({ nullable: true })
  contractId: string;

  @Column({ nullable: true })
  ledger: number;

  @Column({ default: false })
  isVerified: boolean;

  @Column({ nullable: true })
  metadata: string;

  @CreateDateColumn()
  issuedAt: Date;
}
