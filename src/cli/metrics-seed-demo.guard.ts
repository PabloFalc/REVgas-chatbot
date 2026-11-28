import 'dotenv/config';

if (process.env.NODE_ENV === 'production') {
  console.error('Recusado: o seed de demonstração não roda com NODE_ENV=production.');
  process.exit(1);
}
