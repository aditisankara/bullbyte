import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { join } from 'path';
import * as schema from './schema';

export const DRIZZLE = Symbol('DRIZZLE');
export const DB_POOL = Symbol('DB_POOL');

export type DrizzleDB = NodePgDatabase<typeof schema>;

@Global()
@Module({
	providers: [
		{
			provide: DB_POOL,
			useFactory: async (): Promise<Pool> => {
				if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
					throw new Error('DATABASE_URL must be set in production');
				}
				return new Pool({
					connectionString:
						process.env.DATABASE_URL ??
						'postgresql://postgres:postgres@localhost:5432/bullbyte',
				});
			},
		},
		{
			provide: DRIZZLE,
			useFactory: async (pool: Pool): Promise<DrizzleDB> => {
				const db = drizzle(pool, { schema });
				// Single-replica assumption: migrate() is not safe under concurrent replicas.
				// Add pg_advisory_lock here if multi-replica deployment is ever needed.
				try {
					await migrate(db, {
						migrationsFolder: join(__dirname, 'migrations'),
					});
				} catch (err) {
					await pool.end();
					throw err;
				}
				return db;
			},
			inject: [DB_POOL],
		},
	],
	exports: [DRIZZLE],
})
export class DrizzleModule implements OnModuleDestroy {
	constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

	async onModuleDestroy(): Promise<void> {
		await this.pool.end();
	}
}
