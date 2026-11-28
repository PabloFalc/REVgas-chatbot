import 'dotenv/config';
import { ALLOW_REMOTE_SEED_VAR, decideSeedTarget } from './metrics-seed-demo.target';

const decision = decideSeedTarget({
  nodeEnv: process.env.NODE_ENV,
  databaseUrl: process.env.DATABASE_URL,
  allowRemote: process.env[ALLOW_REMOTE_SEED_VAR],
});

if (!decision.allowed) {
  console.error(decision.message);
  process.exit(1);
}
