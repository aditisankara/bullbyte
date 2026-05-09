export default {
	schema: './db/schema.ts',
	out: './db/migrations',
	dialect: 'postgresql',
	dbCredentials: {
		url: process.env.DATABASE_URL,
	},
};
