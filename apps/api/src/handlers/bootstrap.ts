import { connectDb } from '../db';
import { registerModules } from '../bootstrap';
import { bootstrapStage, purgeDemo, seedStagingDemo } from '../ops/stage';

/** `npx serverless invoke -f bootstrap --stage staging --data '{"adminEmail":"you@eayni.local"}'` → first admin + departments. */
export const handler = async (event: { adminEmail?: string; displayNameAr?: string } = {}) => {
  if (!event.adminEmail) throw new Error('adminEmail is required');
  await connectDb();
  registerModules();
  return bootstrapStage({ adminEmail: event.adminEmail, displayNameAr: event.displayNameAr });
};

/** `npx serverless invoke -f seedStagingDemo --stage staging` → sample people; passwords in the output only. */
export const seedDemoHandler = async () => {
  await connectDb();
  registerModules();
  return seedStagingDemo();
};

/** `npx serverless invoke -f purgeDemo --stage staging` → removes everything the demo seed created. */
export const purgeDemoHandler = async () => {
  await connectDb();
  registerModules();
  return purgeDemo();
};
