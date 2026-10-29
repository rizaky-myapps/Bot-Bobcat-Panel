import mongoose from 'mongoose';
import { config } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('db');

mongoose.set('strictQuery', true);

let connecting = null;

export async function connectDatabase(uri = config.mongoUri) {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connecting) return connecting;
  connecting = mongoose
    .connect(uri, { serverSelectionTimeoutMS: 10_000 })
    .then(() => {
      log.success(`Connecté à MongoDB (${mongoose.connection.name})`);
      return mongoose.connection;
    })
    .catch((err) => {
      connecting = null;
      log.error('Connexion MongoDB impossible :', err.message);
      throw err;
    });
  return connecting;
}

export async function disconnectDatabase() {
  connecting = null;
  await mongoose.disconnect();
}

export { mongoose };
